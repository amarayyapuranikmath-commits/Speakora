import json,sys
t=open(sys.argv[1]).read(); j=json.loads(t[t.index('{'):t.rindex('}')+1])
m=j['matching']; w=j['websocket']; s=j['signalling']; sv=j['server']
print(f"{j['label']}: users={j['users']} wall={j['wallSeconds']}s aborted={j['aborted']}")
print(f"  ticket  p50/p95/p99/max ms = {j['ticket']['p50']}/{j['ticket']['p95']}/{j['ticket']['p99']}/{j['ticket']['max']}  failures={j['ticket']['failures']}")
print(f"  ws      opened={w['opened']} connectFail={w['connectFailures']} connect p95={w['connect']['p95']}ms closeCodes={w['closeCodes']}")
print(f"  match   users matched={m['matchedUsers']} calls={m['calls']} noMatch={m['noMatchWithinTimeout']} queueTimeouts={m['queueTimeouts']}")
print(f"          join->found p50/p95/p99/max = {m['joinToFound']['p50']}/{m['joinToFound']['p95']}/{m['joinToFound']['p99']}/{m['joinToFound']['max']} ms")
print(f"          after both queued p50/p95/p99/max = {m['latencyAfterBothQueued']['p50']}/{m['latencyAfterBothQueued']['p95']}/{m['latencyAfterBothQueued']['p99']}/{m['latencyAfterBothQueued']['max']} ms")
print(f"  signal  relayed={s['relayed']} offer->answer p50/p95/max = {s['offerToAnswerRtt']['p50']}/{s['offerToAnswerRtt']['p95']}/{s['offerToAnswerRtt']['max']} ms callsEnded={s['callsEnded']} errors={s['errors']}")
print(f"  server  heap {sv['heapBeforeMb']}->{sv['heapPeakMb']} MB, process CPU peak {sv['processCpuPeak']*100:.0f}%, system CPU peak {sv['systemCpuPeak']*100:.0f}%, threads {sv['threadsBefore']}->{sv['threadsPeak']}, hikari active peak {sv['hikariActivePeak']}/10 pending {sv['hikariPendingPeak']} acquire max {sv['hikariAcquireMaxMs']} ms, tomcat busy peak {sv['tomcatThreadsBusyPeak']}/200")
print(f"  machine min free memory {j['machine']['minFreeMemMb']} MB")
