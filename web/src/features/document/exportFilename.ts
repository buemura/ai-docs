const MAX_SLUG_LENGTH = 80
const H1_PATTERN = /^#[ \t]+(.+?)[ \t#]*$/m

function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '')
}

export function exportFilename(content: string): string {
  const match = H1_PATTERN.exec(content)
  const slug = match ? slugify(match[1]) : ''
  return `${slug || 'document'}.md`
}
