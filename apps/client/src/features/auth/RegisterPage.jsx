import { useState } from 'react'
import { Link } from 'react-router'
import { FormField } from '../../components/FormField.jsx'
import { useAuth } from './authContext.js'
import {
  describeAuthError,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validateRegistration,
} from './validation.js'

export function RegisterPage() {
  const { register } = useAuth()
  const [values, setValues] = useState({ name: '', email: '', password: '' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const update = (event) =>
    setValues((v) => ({ ...v, [event.target.name]: event.target.value }))

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return
    const errors = validateRegistration(values)
    setFieldErrors(errors)
    setFormError(null)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      // On success <GuestOnly> redirects into the app.
      await register({
        name: values.name.trim(),
        email: values.email.trim(),
        password: values.password,
      })
    } catch (error) {
      const { form, fields } = describeAuthError(error)
      setFormError(form)
      setFieldErrors(fields)
      setSubmitting(false)
    }
  }

  return (
    <section className="card auth-card" aria-labelledby="register-heading">
      <h2 id="register-heading">Create an account</h2>
      <form onSubmit={handleSubmit} noValidate>
        {formError && (
          <p role="alert" className="form-error">
            {formError}
          </p>
        )}
        <FormField
          id="name"
          label="Name"
          type="text"
          autoComplete="name"
          value={values.name}
          onChange={update}
          error={fieldErrors.name}
          required
        />
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
          autoComplete="new-password"
          hint={`${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters.`}
          value={values.password}
          onChange={update}
          error={fieldErrors.password}
          required
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="auth-switch">
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </section>
  )
}
