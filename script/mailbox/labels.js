export function normalizeLabels(labels = []) {
    if (!Array.isArray(labels) || labels.length > 20) { throw new TypeError('Use up to 20 labels') }
    const result = []
    for (const value of labels) {
        if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 40 || /[\x00-\x1f\x7f]/.test(value)) {
            throw new TypeError('Labels must contain 1–40 characters')
        }
        const name = value.trim()
        if (!hasLabel(result, name)) { result.push(name) }
    }
    return result
}

export function threadLabels(thread) {
    const names = new Map()
    for (const message of thread.messages) {
        for (const label of message.labels ?? []) { names.set(label.toLowerCase(), label) }
    }
    return [...names.values()]
}

// Gmail label palette: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels#Color
export const LABEL_COLORS = [
    { name: 'Gray', background: '#efefef', text: '#434343' },
    { name: 'Blue', background: '#c9daf8', text: '#1c4587' },
    { name: 'Green', background: '#b9e4d0', text: '#076239' },
    { name: 'Yellow', background: '#fef1d1', text: '#684e07' },
    { name: 'Orange', background: '#ffe6c7', text: '#7a4706' },
    { name: 'Red', background: '#f6c5be', text: '#822111' },
    { name: 'Purple', background: '#e4d7f5', text: '#41236d' },
    { name: 'Pink', background: '#fcdee8', text: '#83334c' },
]

const DEFAULT_COLORS = { portfolio: 'Gray', projects: 'Blue', python: 'Yellow', ai: 'Green', writing: 'Purple', career: 'Blue',
    javascript: 'Yellow', typescript: 'Blue', html: 'Orange', css: 'Blue', java: 'Red', go: 'Blue', aws: 'Orange',
    dynamodb: 'Blue', s3: 'Green', ec2: 'Orange', cloudfront: 'Purple', cognito: 'Purple', ses: 'Blue', astro: 'Pink' }
const TECHNOLOGIES = new Set(['html', 'css', 'javascript', 'typescript', 'java', 'go', 'python', 'sql', 'react', 'react native',
    'node.js', 'spring boot', 'astro', 'docker', 'aws', 'dynamodb', 's3', 'ec2', 'cloudfront', 'cognito', 'ses', 'postgresql', 'mongodb'])

export function labelAppearance(name, preferences = {}) {
    const key = name.toLowerCase()
    const settings = preferences.labelAppearance?.[key] ?? {}
    const color = LABEL_COLORS.find((value) => value.name === (settings.color ?? DEFAULT_COLORS[key])) ?? LABEL_COLORS[0]
    return { ...color, sidebar: settings.sidebar ?? !TECHNOLOGIES.has(key), messages: settings.messages !== false }
}

export function availableLabels(threads, preferences = {}) {
    const removed = new Set(preferences.removedLabels ?? [])
    const names = new Map()
    for (const name of [...Object.values(threads).flatMap(threadLabels), ...(preferences.labels ?? [])]) {
        const key = name.toLowerCase()
        if (!removed.has(key) && !names.has(key)) { names.set(key, name) }
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b))
}

export function labelAssignments(threads, preferences = {}) {
    const removed = new Set(preferences.removedLabels ?? [])
    return Object.fromEntries(
        Object.entries(threads).map(([id, thread]) => [
            id,
            normalizeLabels(preferences.threadLabels?.[id] ?? threadLabels(thread)).filter((name) => !removed.has(name.toLowerCase())),
        ]),
    )
}

export function removeLabelPreferences(threads, preferences, name) {
    const key = name.toLowerCase()
    const removedLabels = [...new Set([...(preferences.removedLabels ?? []), key])]
    const appearance = { ...preferences.labelAppearance }
    delete appearance[key]
    return {
        ...preferences,
        removedLabels,
        labels: (preferences.labels ?? []).filter((label) => label.toLowerCase() !== key),
        labelAppearance: appearance,
        threadLabels: { ...preferences.threadLabels, ...labelAssignments(threads, { ...preferences, removedLabels }) },
    }
}

export function hasLabel(labels, name) {
    const key = name.toLowerCase()
    return labels.some((label) => label.toLowerCase() === key)
}
