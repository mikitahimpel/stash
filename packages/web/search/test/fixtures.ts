// Synthetic search hits in their wire (JSON) form.

export const link = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  url: `https://example.com/articles/${id}`,
  canonicalUrl: null,
  title: `Example article ${id}`,
  status: "new",
  type: null,
  summary: null,
  language: null,
  tags: [],
  sourceDeviceId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  enrichedAt: null,
  ...overrides,
});

export const results = (...ids: ReadonlyArray<string>) => ({
  hits: ids.map((id, i) => ({ link: link(id), score: 1 - i / 10 })),
});
