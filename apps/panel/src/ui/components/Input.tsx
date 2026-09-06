import { styled, Stack, Text } from '@tamagui/core'
import { Input, TextArea } from '@tamagui/input'
import { Eye, EyeOff } from '@tamagui/lucide-icons'
import { forwardRef, useCallback, useState } from 'react'

type InputStyle = Record<string, unknown>

// ---------------------------------------------------------------------------
// InputFrame — cross-platform text input.
//
// Functional wrapper (not `styled(Input, ...)`) on top of Tamagui's `Input`.
// `styled(Input)` silently broke `onChangeText` under Preact/compat +
// @tamagui/react-native-web-lite because the extra styled layer intercepts
// the focus/change event chain. Passing variant styles as inline props keeps
// the event delegation intact across React / Preact / full RNW / lite RNW.
//
// Props listed explicitly (no extends from Input) because Tamagui's complex
// type intersections don't survive Omit/forwardRef resolution. The ...rest is
// cast to a generic record when spreading onto <Input> — it works correctly at
// runtime regardless.
// ---------------------------------------------------------------------------

export type InputVariant = 'default' | 'error' | 'underline'
export type InputSize = 'sm' | 'md' | 'lg' | 'xl'

export interface InputFrameProps {
  variant?: InputVariant
  inputSize?: InputSize
  fullWidth?: boolean
  value?: string
  placeholder?: string
  onChangeText?: (text: string) => void
  onChange?: (e: unknown) => void
  onFocus?: () => void
  onBlur?: () => void
  onKeyPress?: (e: { nativeEvent: { key: string } }) => void
  onSubmitEditing?: () => void | Promise<void>
  disabled?: boolean
  editable?: boolean
  secureTextEntry?: boolean
  keyboardType?: string
  inputMode?: string
  autoCapitalize?: string
  autoComplete?: string
  autoCorrect?: string
  multiline?: boolean
  numberOfLines?: number
  maxLength?: number
  autoFocus?: boolean
  fontFamily?: string
  fontSize?: number | string
  fontWeight?: string | number
  color?: string
  textAlign?: string
  backgroundColor?: string
  borderColor?: string
  borderWidth?: number | string
  borderBottomWidth?: number | string
  borderRadius?: number | string
  padding?: number | string
  paddingHorizontal?: number | string
  paddingVertical?: number | string
  paddingRight?: number | string
  width?: number | string
  height?: number | string
  minWidth?: number | string
  minHeight?: number | string
  flex?: number | string
  className?: string
  selectionColor?: string
  placeholderTextColor?: string
  opacity?: number | string
  unstyled?: boolean
  hoverStyle?: Record<string, unknown>
  focusStyle?: Record<string, unknown>
  style?: Record<string, unknown>
}

const BASE_STYLE: InputStyle = {
  fontFamily: '$body',
  fontSize: 15,
  // Safari zooms the page in when a focused field is under 16px, and never
  // zooms back out — the layout is left shifted and half off-screen. Media
  // styles outrank the plain fontSize above and in every SIZE_STYLES entry, so
  // this one rule lifts all of them on touch devices; `lg`/`xl` are already 16
  // and don't move.
  $pointerCoarse: { fontSize: 16 },
  color: '$color',
  backgroundColor: '$background',
  borderWidth: 1,
  borderColor: '$borderColor',
  borderRadius: 10,
  paddingVertical: 12,
  paddingHorizontal: 14,
  minHeight: 48,
  placeholderTextColor: '$placeholderColor',
  hoverStyle: { borderColor: '$borderColorHover' },
  // Focus ring via outline, not a thicker border: growing borderWidth 1→2 on
  // focus resized the box and shoved the label/content by a pixel. outline sits
  // outside layout, so the field stays put.
  outlineWidth: 0,
  outlineStyle: 'solid',
  outlineColor: '$borderColorFocus',
  focusStyle: { borderColor: '$borderColorFocus', outlineWidth: 2 },
}

const VARIANT_STYLES: Record<InputVariant, InputStyle> = {
  default: {},
  error: {
    borderColor: '$error500',
    focusStyle: { borderColor: '$error600', borderWidth: 2, outlineWidth: 2 },
  },
  underline: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderBottomWidth: 1,
    borderRadius: 0,
    paddingHorizontal: 0,
    focusStyle: {
      borderBottomWidth: 1,
      borderWidth: 0,
      borderColor: '$borderColorFocus',
      outlineWidth: 2,
    },
  },
}

const SIZE_STYLES: Record<InputSize, InputStyle> = {
  sm: {
    minHeight: 40,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 13,
    borderRadius: 8,
  },
  md: {},
  lg: {
    minHeight: 56,
    paddingVertical: 16,
    paddingHorizontal: 16,
    fontSize: 16,
    borderRadius: 12,
  },
  xl: {
    minHeight: 52,
    fontSize: 16,
  },
}

const FULL_WIDTH_STYLE: InputStyle = {
  width: '100%',
  alignSelf: 'stretch',
}

const InputFrame = forwardRef<unknown, InputFrameProps>(function InputFrame(
  { variant = 'default', inputSize = 'md', fullWidth, onChangeText, onChange, ...rest },
  ref,
) {
  const handleChange = useCallback(
    (e: unknown) => {
      const value = (e as any)?.target?.value ?? (e as any)?.nativeEvent?.text ?? String(e ?? '')
      onChangeText?.(value)
      onChange?.(e as never)
    },
    [onChangeText, onChange],
  )

  return (
    <Input
      ref={ref as never}
      {...BASE_STYLE}
      {...SIZE_STYLES[inputSize]}
      {...VARIANT_STYLES[variant]}
      {...(fullWidth ? FULL_WIDTH_STYLE : null)}
      {...(rest as InputStyle)}
      onChange={handleChange}
    />
  )
})

InputFrame.displayName = 'InputFrame'

// ---------------------------------------------------------------------------
// TextAreaFrame — multiline sibling of InputFrame. Same functional-wrapper
// rationale: `styled(TextArea)` breaks `onChangeText` under Preact / RNW-lite,
// so we pass the variant styles as inline props instead. Shares the input
// tokens; just taller and top-aligned.
// ---------------------------------------------------------------------------
export interface TextAreaFrameProps {
  variant?: InputVariant
  fullWidth?: boolean
  value?: string
  placeholder?: string
  onChangeText?: (text: string) => void
  onChange?: (e: unknown) => void
  onFocus?: () => void
  onBlur?: () => void
  onKeyPress?: (e: { nativeEvent: { key: string } }) => void
  onSubmitEditing?: () => void | Promise<void>
  disabled?: boolean
  editable?: boolean
  multiline?: boolean
  numberOfLines?: number
  fontFamily?: string
  fontSize?: number | string
  fontWeight?: string | number
  color?: string
  backgroundColor?: string
  borderColor?: string
  borderWidth?: number | string
  borderRadius?: number | string
  padding?: number | string
  paddingHorizontal?: number | string
  paddingVertical?: number | string
  width?: number | string
  height?: number | string
  minWidth?: number | string
  minHeight?: number | string
  flex?: number | string
  unstyled?: boolean
  hoverStyle?: Record<string, unknown>
  focusStyle?: Record<string, unknown>
}

const TEXTAREA_BASE_STYLE: InputStyle = {
  ...BASE_STYLE,
  minHeight: 112,
  paddingVertical: 10,
  // RNW passes this through to the DOM textarea so the caret starts at the top.
  textAlignVertical: 'top',
}

const TextAreaFrame = forwardRef<unknown, TextAreaFrameProps>(function TextAreaFrame(
  { variant = 'default', fullWidth, onChangeText, onChange, ...rest },
  ref,
) {
  // Same onChange→onChangeText bridge as InputFrame: native `onChangeText` is
  // broken under Preact / RNW-lite, so a bare `<TextArea onChangeText>` never
  // fires and the controlled value stays empty (the textarea reads as "can't
  // type"). Derive the value from the DOM change event instead.
  const handleChange = useCallback(
    (e: unknown) => {
      const value = (e as any)?.target?.value ?? (e as any)?.nativeEvent?.text ?? String(e ?? '')
      onChangeText?.(value)
      onChange?.(e as never)
    },
    [onChangeText, onChange],
  )

  return (
    <TextArea
      ref={ref as never}
      {...TEXTAREA_BASE_STYLE}
      {...VARIANT_STYLES[variant]}
      {...(fullWidth ? FULL_WIDTH_STYLE : null)}
      {...(rest as InputStyle)}
      onChange={handleChange}
    />
  )
})

TextAreaFrame.displayName = 'TextAreaFrame'

// ---------------------------------------------------------------------------
// Label, HintText, ErrorText — still fine as `styled(Text)` because Text is
// display-only and doesn't take controlled input events.
// ---------------------------------------------------------------------------
const Label = styled(Text, {
  name: 'Label',
  fontFamily: '$body',
  fontWeight: '500',
  fontSize: 13,
  color: '$color',
  marginBottom: 6,
})

const HintText = styled(Text, {
  name: 'HintText',
  fontFamily: '$body',
  fontSize: 12,
  color: '$color11',
  marginTop: 4,
})

const ErrorText = styled(Text, {
  name: 'ErrorText',
  fontFamily: '$body',
  fontSize: 12,
  color: '$error600',
  marginTop: 4,
})

const FormFieldFrame = styled(Stack, {
  name: 'FormField',
  flexDirection: 'column',
  gap: 0,
})

// ---------------------------------------------------------------------------
// FormField — composite: label + input + hint/error
// ---------------------------------------------------------------------------
interface FormFieldProps extends InputFrameProps {
  label?: string
  hint?: string
  error?: string
}

function FormField({
  label,
  hint,
  error,
  variant,
  inputSize = 'md',
  secureTextEntry,
  ...inputProps
}: FormFieldProps): React.ReactElement {
  const resolvedVariant: InputVariant = error ? 'error' : (variant ?? 'default')
  const [revealed, setRevealed] = useState(false)

  return (
    <FormFieldFrame>
      {label ? <Label>{label}</Label> : null}
      {secureTextEntry ? (
        // Password field: an eye toggle so the user can verify what they typed.
        // The reveal is local (never leaves the input's own state).
        <Stack position="relative" width="100%">
          <InputFrame
            variant={resolvedVariant}
            inputSize={inputSize}
            secureTextEntry={!revealed}
            paddingRight={44}
            {...inputProps}
          />
          <Stack
            position="absolute"
            right={12}
            top={0}
            bottom={0}
            justifyContent="center"
            cursor="pointer"
            onPress={() => setRevealed((v) => !v)}
            aria-label={revealed ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            hoverStyle={{ opacity: 0.7 }}
          >
            {revealed ? (
              <EyeOff size={18} color="$placeholderColor" />
            ) : (
              <Eye size={18} color="$placeholderColor" />
            )}
          </Stack>
        </Stack>
      ) : (
        <InputFrame variant={resolvedVariant} inputSize={inputSize} {...inputProps} />
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {!error && hint ? <HintText>{hint}</HintText> : null}
    </FormFieldFrame>
  )
}

FormField.displayName = 'FormField'

type InputProps = InputFrameProps

export { InputFrame, TextAreaFrame, Label, HintText, ErrorText, FormField }
export type { InputProps, FormFieldProps }
