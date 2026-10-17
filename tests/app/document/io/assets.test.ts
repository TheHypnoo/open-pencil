import { describe, expect, test } from 'bun:test'

import { readBoundedBody } from '@/app/document/io/assets'

/** A response whose body arrives as the chunks given, with no declared length. */
function streamed(chunks: Uint8Array[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    }
  })
  return new Response(body)
}

describe('reading an image body under a byte limit', () => {
  test('joins the chunks of a body that fits', async () => {
    const bytes = await readBoundedBody(
      streamed([new Uint8Array([1, 2]), new Uint8Array([3, 4])]),
      4
    )

    expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  test('stops at the limit instead of buffering a body that exceeds it', async () => {
    const bytes = await readBoundedBody(
      streamed([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])]),
      4
    )

    expect(bytes).toBeUndefined()
  })

  test('refuses a body whose declared length already exceeds the limit', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-length': '3' }
    })

    expect(await readBoundedBody(response, 2)).toBeUndefined()
  })
})
