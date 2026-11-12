#!/usr/bin/env python3
"""Reads one saved email (.eml) and reports what decides whether mail providers trust it.

How to get a message to check: open the email in Gmail (the Spam folder too), the three-dot menu, "Download message", then

    python tools/check-email-headers.py path\\to\\message.eml

It reports, from the headers of THAT message as the receiving provider recorded them:
  - SPF, DKIM and DMARC results and whether each is aligned with the From address (only a message that was received from another
    mailbox has them: a message delivered to the sending account itself carries none, and the tool says so);
  - the sender identity (From, envelope sender, Reply-To, Sender) and whether they agree with each other;
  - the Message-ID and the first "Received" hop (the sending machine's name and address);
  - the message structure (plain text or HTML, parts, links, hidden text).
It does not guess a spam score and it does not claim anything about where a message will land.
"""
import re
import sys
from email import policy
from email.parser import BytesParser

OK, WARN, BAD, INFO = 'OK   ', 'WARN ', 'FAIL ', 'info '


def domain_of(address):
    m = re.search(r'@([A-Za-z0-9.-]+)', address or '')
    return m.group(1).lower() if m else ''


def organisational(d):
    """Good enough for gmail.com, example.co.uk-style names and sub-domains: the last two labels (three for a few common country suffixes)."""
    parts = d.split('.')
    if len(parts) >= 3 and parts[-2] in ('co', 'com', 'org', 'net', 'ac', 'gov') and len(parts[-1]) == 2:
        return '.'.join(parts[-3:])
    return '.'.join(parts[-2:])


def aligned(a, b):
    return bool(a) and bool(b) and organisational(a) == organisational(b)


def main(path):
    with open(path, 'rb') as f:
        m = BytesParser(policy=policy.default).parse(f)
    report = []

    def line(level, text):
        report.append(f'{level} {text}')

    frm = str(m['From'] or '')
    from_dom = domain_of(frm)
    print(f'Message: {str(m["Subject"] or "")[:80]}')
    print(f'From: {frm}   To: {str(m["To"] or "")[:80]}')
    print()

    # ---- authentication as recorded by the receiving provider -----------------------------------------------------------------------
    auth = ' '.join(str(v) for v in (m.get_all('Authentication-Results') or []))
    arc = ' '.join(str(v) for v in (m.get_all('ARC-Authentication-Results') or []))
    results = auth or arc
    if not results:
        line(INFO, 'No Authentication-Results header: this copy was not received from another mailbox (for example it is the sender\'s own copy, or it was '
                   'delivered to the sending account itself), so SPF, DKIM and DMARC cannot be read from it. Check a message that sits in the recipient\'s mailbox.')
    else:
        for mech in ('spf', 'dkim', 'dmarc'):
            hits = re.findall(rf'\b{mech}=(\w+)([^;]*)', results)
            if not hits:
                line(WARN, f'{mech.upper()}: no result recorded')
                continue
            result, rest = hits[0]
            who = re.search(r'(?:header\.(?:i|d|from)|smtp\.mailfrom|smtp\.helo)=([^\s;)]+)', rest)
            detail = f' ({who.group(0)})' if who else ''
            line(OK if result == 'pass' else BAD, f'{mech.upper()} = {result}{detail}')
            if mech == 'dkim' and who:
                d = domain_of(who.group(1)) or who.group(1).lstrip('@')
                line(OK if aligned(d, from_dom) else WARN, f'DKIM signing domain "{d}" {"matches" if aligned(d, from_dom) else "does NOT match"} the From domain "{from_dom}"')
    for sig in m.get_all('DKIM-Signature') or []:
        d = re.search(r'\bd=([^;\s]+)', str(sig))
        s = re.search(r'\bs=([^;\s]+)', str(sig))
        line(INFO, f'DKIM-Signature present: d={d.group(1) if d else "?"} selector={s.group(1) if s else "?"}')

    # ---- sender identity ---------------------------------------------------------------------------------------------------------
    rp = str(m['Return-Path'] or '')
    if rp:
        line(OK if aligned(domain_of(rp), from_dom) else WARN, f'Return-Path (envelope sender) {rp} {"agrees with" if aligned(domain_of(rp), from_dom) else "differs from"} the From domain')
    if m['Sender']:
        line(WARN if str(m['Sender']) != frm else INFO, f'Sender header present: {m["Sender"]} (a second identity; fine only if it is the same organisation)')
    else:
        line(OK, 'No separate Sender header')
    if m['Reply-To']:
        rt_dom = domain_of(str(m['Reply-To']))
        line(OK if aligned(rt_dom, from_dom) else WARN, f'Reply-To {m["Reply-To"]} {"is" if aligned(rt_dom, from_dom) else "is NOT"} on the From domain')
    else:
        line(INFO, 'No Reply-To (replies go to the From address)')

    # ---- message id and the sending machine --------------------------------------------------------------------------------------
    mid = str(m['Message-ID'] or '')
    host = mid.strip('<>').split('@')[-1] if '@' in mid else ''
    if not mid:
        line(BAD, 'No Message-ID')
    elif '.' not in host:
        line(WARN, f'Message-ID {mid} ends in "{host}", which is not a fully qualified domain name (the sending computer\'s own name)')
    else:
        line(OK, f'Message-ID {mid[:70]} has a qualified domain')
    received = m.get_all('Received') or []
    if received:
        last = re.sub(r'\s+', ' ', str(received[-1]))
        line(INFO, f'First hop: {last[:200]}')
        if re.search(r'from \S+ \(\[[0-9.]+\]\) by smtp\.gmail\.com', last):
            hello = re.search(r'from (\S+) ', last).group(1)
            ip = re.search(r'\[([0-9.]+)\]', last).group(1)
            line(WARN if '.' not in hello else INFO, f'Gmail recorded the sending computer as "{hello}" at {ip}. Mail sent from a home or mobile connection carries that address; a server with a fixed address and a proper name is better.')

    # ---- structure --------------------------------------------------------------------------------------------------------------
    types = [p.get_content_type() for p in m.walk()]
    line(INFO, f'MIME structure: {types}')
    body = ''
    for p in m.walk():
        if p.get_content_type() in ('text/plain', 'text/html'):
            try:
                body += p.get_content()
            except Exception:
                pass
    links = sorted(set(re.findall(r'https?://[^\s"<>)]+', body)))
    line(OK if not links else WARN, f'Links in the message: {len(links)}' + (f' ({", ".join(links[:3])})' if links else ''))
    if any(re.search(r'localhost|127\.0\.0\.1|192\.168\.|\b10\.\d+\.\d+\.\d+', link) for link in links):
        line(BAD, 'A link points at localhost or a private address: nobody else can open it')
    line(OK if 'display:none' not in body.replace(' ', '') else WARN, 'Hidden text (display:none)' + (' present' if 'display:none' in body.replace(' ', '') else ' absent'))
    line(INFO, 'HTML version present' if 'text/html' in types else 'Plain text only')
    if m['Auto-Submitted']:
        line(OK, f'Auto-Submitted: {m["Auto-Submitted"]}')
    for l in report:
        print(l)
    print()
    print('This tool reports facts from the headers. It cannot say where a message will land: that is decided by the receiving provider.')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    main(sys.argv[1])
