import { AlertCircle, CheckCircle2, Check, ChevronDown, Info, X } from 'lucide-react-native'
import { Children, createContext, forwardRef, useContext, useEffect, useState, type ComponentRef, type ReactNode } from 'react'
import {
  ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput,
  View, type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, isDark, palettes, radius, space, themed, type } from './theme'

/* ---------------------------------- layout --------------------------------- */

/**
 * True for screens drawn below an app header that already handles the status bar (the main tabs). Such a screen must not add the
 * top safe-area inset a second time, or a large empty gap appears under the header.
 */
export const HeaderPresentContext = createContext(false)

/**
 * Standard screen: safe area, scrolling content, consistent gutters. The main tabs have no header of their own, so they take the status
 * bar inset here; a screen shown below a navigation header (which already clears the status bar) is wrapped in HeaderPresentContext by the
 * navigator, so the inset is not added twice.
 */
export function Screen({ children, scroll = true, padded = true }: { children: ReactNode; scroll?: boolean; padded?: boolean }) {
  const content = padded ? { padding: space.lg, paddingBottom: space.xxl } : undefined
  const headerPresent = useContext(HeaderPresentContext)
  const below = headerPresent
  return (
    <SafeAreaView style={styles.screen} edges={below ? ['left', 'right'] : ['top', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {scroll ? (
          <ScrollView contentContainerStyle={content} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        ) : (
          <View style={[{ flex: 1 }, content]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

export function Title({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <View style={{ marginBottom: space.xl }}>
      <Text accessibilityRole="header" style={type.title}>{children}</Text>
      {sub ? <Text style={[type.small, { marginTop: space.sm, fontSize: 16, lineHeight: 23 }]}>{sub}</Text> : null}
    </View>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text accessibilityRole="header" style={[type.heading, { marginBottom: space.md, marginTop: space.xl }]}>{children}</Text>
}

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>
}

/** A list whose rows are separated by hairlines: no box around each item, so long lists stay light. */
export function RowList({ children }: { children: ReactNode }) {
  const items = Children.toArray(children)
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.line }}>
      {items.map((c, i) => <View key={i} style={{ borderBottomWidth: 1, borderBottomColor: colors.line }}>{c}</View>)}
    </View>
  )
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line }} />
}

/* --------------------------------- controls -------------------------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'inverse'

export function Button({
  label, onPress, variant = 'primary', loading, disabled, icon, style, accessibilityHint,
}: {
  label: string; onPress: () => void; variant?: Variant; loading?: boolean; disabled?: boolean; icon?: ReactNode
  style?: StyleProp<ViewStyle>; accessibilityHint?: string
}) {
  const off = disabled || loading
  // `inverse` is white in both themes (it sits on the always-navy welcome artwork); the others follow the theme.
  const bg = { primary: colors.accent, secondary: colors.surface, ghost: 'transparent', danger: colors.danger, inverse: palettes.light.white }[variant]
  const fg = { primary: colors.onAccent, secondary: colors.ink, ghost: colors.muted, danger: colors.onAccent, inverse: palettes.light.accent }[variant]
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: off ? 0.5 : 1 },
        variant === 'secondary' && { borderWidth: 1, borderColor: colors.lineStrong },
        pressed && variant === 'primary' && { backgroundColor: colors.accentPressed },
        pressed && variant !== 'primary' && { opacity: 0.7 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon}
      <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
    </Pressable>
  )
}

/**
 * Every text box in the app is this one. The text colour, background, placeholder colour, cursor, selection and handles are set explicitly
 * from the app's own palette (dark text on light, or light text on dark), so what you type is always readable, whatever the phone's own
 * theme or keyboard does. Never use a bare TextInput.
 */
export const Input = forwardRef<ComponentRef<typeof TextInput>, TextInputProps>(function Input({ style, ...rest }, ref) {
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.subtle}
      selectionColor={colors.accent}
      cursorColor={colors.accent}
      selectionHandleColor={colors.accent}
      underlineColorAndroid="transparent"
      keyboardAppearance={isDark() ? 'dark' : 'light'}
      style={[{ color: colors.ink, backgroundColor: colors.surface, fontSize: 16 }, style]}
      {...rest}
    />
  )
})

/** The height of the on-screen keyboard (0 when hidden), for layouts that must stay above it. */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates?.height ?? 0))
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0))
    return () => { show.remove(); hide.remove() }
  }, [])
  return height
}

export function TextField({ label, error, hint, ...rest }: TextInputProps & { label: string; error?: string; hint?: string }) {
  const [focused, setFocused] = useState(false)
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={[type.label, { marginBottom: 6 }]}>{label}</Text>
      <Input
        accessibilityLabel={label}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.input, { borderColor: error ? colors.danger : focused ? colors.accent : colors.lineStrong }]}
        {...rest}
      />
      {error ? <Text accessibilityRole="alert" style={[type.caption, { color: colors.danger, marginTop: 6, fontWeight: '600' }]}>{error}</Text>
        : hint ? <Text style={[type.caption, { marginTop: 6 }]}>{hint}</Text> : null}
    </View>
  )
}

/** Picker that opens a full list in a modal: native-feeling and works for long lists (countries, languages, time zones). */
export function PickerField({
  label, value, options, onChange, placeholder = 'Select', error,
}: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; placeholder?: string; error?: string }) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={[type.label, { marginBottom: 6 }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? placeholder}`}
        onPress={() => setOpen(true)}
        style={[styles.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderColor: error ? colors.danger : colors.lineStrong }]}
      >
        <Text style={{ fontSize: 16, color: current ? colors.ink : colors.subtle }}>{current?.label ?? placeholder}</Text>
        <ChevronDown size={18} color={colors.muted} />
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={[type.caption, { color: colors.danger, marginTop: 6, fontWeight: '600' }]}>{error}</Text> : null}
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={styles.screen}>
          <View style={styles.modalHeader}>
            <Text style={type.heading}>{label}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setOpen(false)} hitSlop={12}><X size={22} color={colors.ink} /></Pressable>
          </View>
          <FlatList
            data={options}
            keyExtractor={(o) => o.value}
            initialNumToRender={20}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: item.value === value }}
                onPress={() => { onChange(item.value); setOpen(false) }}
                style={styles.optionRow}
              >
                <Text style={{ fontSize: 16, color: colors.ink, fontWeight: item.value === value ? '600' : '400' }}>{item.label}</Text>
                {item.value === value ? <Check size={18} color={colors.accent} /> : null}
              </Pressable>
            )}
            ItemSeparatorComponent={Divider}
          />
        </SafeAreaView>
      </Modal>
    </View>
  )
}

export function Toggle({ label, description, value, onChange, disabled }: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1, paddingRight: space.lg }}>
        <Text style={type.label}>{label}</Text>
        {description ? <Text style={[type.small, { marginTop: 2 }]}>{description}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: colors.lineStrong, true: colors.accent }}
        thumbColor={isDark() ? (value ? colors.onAccent : colors.muted) : colors.white}
      />
    </View>
  )
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}
    >
      <Text style={{ fontSize: 14, color: selected ? colors.accent : colors.muted, fontWeight: selected ? '600' : '400' }}>{label}</Text>
    </Pressable>
  )
}

/* --------------------------------- feedback -------------------------------- */

const tones = themed(() => ({
  error: { bg: colors.dangerSoft, fg: colors.danger, Icon: AlertCircle },
  success: { bg: colors.successSoft, fg: colors.success, Icon: CheckCircle2 },
  info: { bg: colors.accentSoft, fg: colors.accent, Icon: Info },
}))

export function Alert({ tone = 'error', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  const t = tones[tone]
  return (
    <View accessibilityRole={tone === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite" style={[styles.alert, { backgroundColor: t.bg }]}>
      <t.Icon size={18} color={t.fg} style={{ marginTop: 2 }} />
      <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: t.fg }}>{children}</Text>
    </View>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <View accessibilityLabel={label} style={{ paddingVertical: space.xxl, alignItems: 'center' }}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={[type.heading, { textAlign: 'center' }]}>{title}</Text>
      {description ? <Text style={[type.small, { textAlign: 'center', marginTop: space.sm }]}>{description}</Text> : null}
      {action ? <View style={{ marginTop: space.lg }}>{action}</View> : null}
    </View>
  )
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <View style={styles.empty}>
      <Text accessibilityRole="alert" style={[type.small, { textAlign: 'center' }]}>{message ?? 'We could not load this. Please try again.'}</Text>
      {onRetry ? <View style={{ marginTop: space.md }}><Button label="Try again" variant="secondary" onPress={onRetry} /></View> : null}
    </View>
  )
}

/** Bottom-sheet style dialog. */
export function Sheet({ title, visible, onClose, children }: { title: string; visible: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} accessibilityLabel="Close dialog" onPress={onClose} />
        <View style={styles.sheet}>
          <View style={[styles.modalHeader, { paddingHorizontal: 0 }]}>
            <Text accessibilityRole="header" style={type.heading}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12}><X size={22} color={colors.ink} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </View>
    </Modal>
  )
}

export function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <View style={{ flex: 1, minWidth: '45%', paddingVertical: space.sm }}>
      <Text style={type.small}>{label}</Text>
      <Text style={{ fontSize: 24, fontWeight: '600', color: colors.ink, marginTop: 2 }}>{value}</Text>
      {hint ? <Text style={type.caption}>{hint}</Text> : null}
    </View>
  )
}

const styles = themed(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  // A section, not a card: content on the page, separated from the next by a hairline.
  panel: { paddingVertical: space.lg, borderTopWidth: 1, borderTopColor: colors.line },
  button: { minHeight: 48, borderRadius: radius.control, paddingHorizontal: space.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  buttonText: { fontSize: 16, fontWeight: '600' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: radius.control, paddingHorizontal: space.md, fontSize: 16, color: colors.ink, backgroundColor: colors.surface },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: space.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  optionRow: { minHeight: 52, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md },
  chip: { borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.surface },
  alert: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.control, marginBottom: space.lg },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.lineStrong, borderRadius: radius.panel, padding: space.xxl, alignItems: 'center' },
  backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: space.xl, maxHeight: '88%' },
}))
