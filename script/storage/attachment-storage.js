import { normalizeAttachments } from '../messages/message-model.js'

let database
function openDatabase() {
    if (!database) {
        database = new Promise((resolve, reject) => {
            const request = indexedDB.open('dmail-files', 1)
            request.onupgradeneeded = () => request.result.createObjectStore('files')
            let blocked = false
            request.onsuccess = () => {
                if (blocked) {
                    request.result.close()
                    return
                }
                request.result.onversionchange = () => {
                    request.result.close()
                    database = null
                }
                resolve(request.result)
            }
            request.onerror = () => {
                database = null
                reject(request.error)
            }
            request.onblocked = () => {
                blocked = true
                database = null
                reject(new Error('Close other portfolio tabs and try again.'))
            }
        })
    }
    return database
}

// A successful IndexedDB request is not durable until its transaction commits.
async function changeFiles(change, errorMessage) {
    const db = await openDatabase()
    await new Promise((resolve, reject) => {
        const transaction = db.transaction('files', 'readwrite')
        transaction.oncomplete = resolve
        transaction.onabort = () => reject(transaction.error || new Error(errorMessage))
        transaction.onerror = () => reject(transaction.error || new Error(errorMessage))
        try { change(transaction.objectStore('files')) } catch (error) {
            transaction.abort()
            reject(error)
        }
    })
}

export async function saveAttachmentBlobs(items = []) {
    const files = normalizeAttachments(items).filter(item => item.blob)
    if (!files.length) { return }
    await changeFiles(store => { for (const item of files) { store.put(item.blob, item.id) } }, 'Could not save attachments')
}

export async function clearAttachmentBlobs(ids, commit) {
    await changeFiles(store => {
        for (const id of ids) { store.delete(id) }
        commit()
    }, 'Could not reset saved attachments')
}

export async function loadAttachmentBlob(id) {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
        const request = db.transaction('files').objectStore('files').get(id)
        request.onsuccess = () =>
            request.result instanceof Blob ? resolve(request.result) : reject(new Error('This attachment is no longer available in this browser.'))
        request.onerror = () => reject(request.error)
    })
}
