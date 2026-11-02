import { apiJSON } from '../storage/portfolio-api.js'

export async function accountRequest(settings, action, input) {
    if (!settings?.enabled) { throw new Error('Sign-in is temporarily unavailable. Please try again later.') }
    return apiJSON('/session/auth', { ...input, action })
}

export function signupProfile(profile) {
    const name = [profile.firstName?.trim(), profile.lastName?.trim()].filter(Boolean).join(' ')
    if (!profile.firstName?.trim() || name.length > 100) { throw new Error('Enter your name using 100 characters or fewer.') }
    const email = normalizeEmail(profile.email)
    const result = { name, email }
    if (profile.birthdate) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(profile.birthdate)) { throw new Error('Enter a valid birthday or leave it blank.') }
        result.birthdate = profile.birthdate
    }
    if (profile.gender) { result.gender = profile.gender }
    if (profile.phone) {
        const phone = profile.phone.replace(/[\s().-]/g, '')
        if (!/^\+[1-9]\d{7,14}$/.test(phone)) { throw new Error('Use a phone number with a country code, such as +1 555 123 4567.') }
        result.phone = phone
    }
    return result
}

export function normalizeEmail(value) {
    const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
    if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) { throw new Error('Enter a valid email address.') }
    return email
}

export function validatePassword(password, confirmation) {
    if (password !== confirmation) { throw new Error('The passwords do not match.') }
    if (typeof password !== 'string' || password.length < 12 || password.length > 256 || !/[A-Z]/.test(password)
        || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9\s]/.test(password)) {
        throw new Error('Use at least 12 characters, including uppercase and lowercase letters, a number, and a symbol.')
    }
}

export function optionalBirthday(month, day, year, today = new Date()) {
    if (!month && !day && !year) { return '' }
    if (!month || !day || !year) { throw new Error('Complete your birthday or leave all three fields blank.') }
    const date = new Date(Number(year), Number(month) - 1, Number(day))
    if (Number(year) < 1900 || date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1
        || date.getDate() !== Number(day) || date > today) { throw new Error('Enter a valid birthday in the past.') }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
