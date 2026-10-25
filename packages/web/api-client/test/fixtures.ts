// Synthetic links in their wire (JSON) form.

export const link = (id: string, status = "new") => ({
  id,
  url: `https://example.com/articles/${id}`,
  canonicalUrl: null,
  title: `Example article ${id}`,
  status,
  type: null,
  summary: null,
  language: null,
  tags: [],
  sourceDeviceId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  enrichedAt: null,
});

export const page = (...ids: ReadonlyArray<string>) => ({
  items: ids.map((id) => link(id)),
  nextCursor: null,
});
