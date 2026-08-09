const BASE_BARK_URL = 'https://api.day.app/'

type BarkConfig = {
  title: string
  content: string
  group: string
}

export function barkURL(config: BarkConfig) {
  const title = config.title ? `${encodeURIComponent(config.title)}/` : ''
  const content = config.content ? `${encodeURIComponent(config.content)}/` : ''
  const group = config.group ? `&group=${config.group}` : ''


  const result = BASE_BARK_URL
    + `${process.env.BARK_KEY}/`
    + title
    + content
    + '?icon=https://unavatar.io/github/qiyuor2'
    + group
  
  return result
}
