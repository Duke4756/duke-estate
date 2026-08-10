export class SourceAdapter {
  collect() {
    throw new Error('SourceAdapter.collect() must be implemented')
  }
}

export function assertRawPost(record) {
  if (!record || typeof record.raw_text !== 'string' || !record.raw_text.trim()) throw new Error('raw_text is required')
  if (!record.source_adapter) throw new Error('source_adapter is required')
  return record
}
