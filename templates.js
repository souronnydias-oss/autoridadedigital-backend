const normalize = (s = '') =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '')

export const PLATFORMS = ['instagram', 'linkedin', 'tiktok', 'facebook', 'whatsapp']

export function generatePosts(dev, broker) {
  const title = dev?.title || 'Nossas oportunidades'
  const subtitle = dev?.subtitle || ''
  const price = dev?.price || 'consulte valores'
  const location = dev?.location || ''
  const description = dev?.description || ''
  const city = (location.split(' - ')[0] || location).trim()
  const tag = normalize(city) || 'imoveis'
  const brokerName = broker?.name || 'corretor'
  const wa = (broker?.whatsapp || '').replace(/\D/g, '')
  const waLink = wa ? `wa.me/${wa}` : ''
  const media = (dev?.media || []).filter(m => m.type === 'image').map(m => m.url)

  const base = `🏡 ${title}${subtitle ? ` — ${subtitle}` : ''}\n`
  const common = `📍 ${location || 'Localização a confirmar'}\n💰 ${price}`
  const cta = waLink ? `\n\n📲 Chame no WhatsApp: ${waLink}\n` : ''
  const tags = `\n\n#lancamento #imoveis #corretorDeImoveis #${tag} #imovelParaVoce`

  return {
    instagram: {
      content: `${base}${common}\n\n${short(description)}\n${cta}\n💬 Fale com ${brokerName}${tags}`,
      media
    },
    linkedin: {
      content: `${title}${subtitle ? ` — ${subtitle}` : ''}\n\n${description}\n\n📍 ${location}\n💰 ${price}\n\nUma curadoria pensada para quem busca localização, valorização e qualidade de vida. Entre em contato para uma apresentação exclusiva.${cta}\n\n#MercadoImobiliario #AltoPadrao #${tag} #Investimento`,
      media
    },
    tiktok: {
      content: `${base}${common}\n👉 Siga para ver mais oportunidades!\n${cta}${tags}`,
      media
    },
    facebook: {
      content: `${base}${description}\n\n${common}${cta}\n${tags.replace(/#/g, ' #').replace(/\s/g, ' ')}`,
      media
    },
    whatsapp: {
      content: `Olá! Tenho uma oportunidade que pode te interessar:\n\n*${title}*${subtitle ? `\n*${subtitle}*` : ''}\n\n${description}\n\n📍 *${location || 'Localização a confirmar'}*\n💰 *${price}*\n\nGostaria de agendar uma visita ou receber mais detalhes?${waLink ? `\n\nClique aqui para conversar: https://${waLink}` : ''}`,
      media
    }
  }
}

const short = (s = '') => (s.length > 120 ? s.slice(0, 120).trim() + '…' : s)