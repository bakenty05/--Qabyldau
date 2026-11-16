import { t } from './i18n'
import { useId } from 'react'

type Props = { value: string; onChange: (phone: string) => void }

export default function PhoneInput({ value, onChange }: Props) {
  const id = useId()
  const nationalNumber = value.startsWith('+7') ? value.slice(2) : ''
  return <div className="phone-field">
    <label htmlFor={id}>{t("Телефон нөмірі")}</label>
    <div className="phone-input">
      <span id={`${id}-prefix`} className="phone-prefix">+7</span>
      <input
        id={id}
        name="phone"
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        required
        minLength={10}
        pattern="[0-9]{10}"
        placeholder="777 123 45 67"
        aria-describedby={`${id}-prefix ${id}-hint`}
        value={nationalNumber}
        onChange={event => {
          const raw = event.target.value
          const digits = raw.replace(/\D/g, '')
          const hasCountryCode = raw.trim().startsWith('+7') || (digits.length === 11 && /^[78]/.test(digits))
          onChange('+7' + (hasCountryCode ? digits.slice(1) : digits).slice(0, 10))
        }}
        onPaste={event => {
          event.preventDefault()
          const raw = event.clipboardData.getData('text')
          const digits = raw.replace(/\D/g, '')
          if (!digits) return
          if (raw.trim().startsWith('+7') || (digits.length === 11 && /^[78]/.test(digits))) {
            onChange('+7' + digits.slice(1, 11))
            return
          }
          const input = event.currentTarget
          const start = input.selectionStart ?? nationalNumber.length
          const end = input.selectionEnd ?? start
          onChange('+7' + (nationalNumber.slice(0, start) + digits + nationalNumber.slice(end)).slice(0, 10))
        }}
      />
    </div>
    <p id={`${id}-hint`} className="hint">{t("+7 кодынан кейінгі 10 цифрды енгізіңіз.")}</p>
  </div>
}
