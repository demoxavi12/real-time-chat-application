import { useState } from 'react'
import { Link } from 'react-router'
import { FormField } from '../../components/FormField.jsx'
import { useAuth } from './authContext.js'
import { describeAuthError, validateLogin } from './validation.js'

export function LoginPage() {
  const { login } = useAuth()
  const [values, setValues] = useState({ email: '', password: '' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const update = (event) =>
    setValues((v) => ({ ...v, [event.target.name]: event.target.value }))

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return
    const errors = validateLogin(values)
    setFieldErrors(errors)
    setFormError(null)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      // On success <GuestOnly> redirects (to the originally requested page).
      await login({ email: values.email.trim(), password: values.password })
    } catch (error) {
      const { form, fields } = describeAuthError(error)
      setFormError(form)
      setFieldErrors(fields)
      setSubmitting(false)
    }
  }

  return (
    <section className="card auth-card" aria-labelledby="login-heading">
      <h2 id="login-heading">Sign in</h2>
      <form onSubmit={handleSubmit} noValidate>
        {formError && (
          <p role="alert" className="form-error">
            {formError}
          </p>
        )}
        <FormField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={update}
          error={fieldErrors.email}
          required
        />
        <FormField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={values.password}
          onChange={update}
          error={fieldErrors.password}
          required
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="auth-switch">
        No account yet? <Link to="/register">Create one</Link>
      </p>
    </section>
  )
}
