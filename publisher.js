// Point de publicação por plataforma.
// V1: registra a ação; integrações reais (Graph API, LinkedIn API, TikTok API)
// entram aqui quando as credenciais forem adicionadas.
export async function publish(post, supabase) {
  const note = `[${post.platform}] post #${post.id} simulado (${new Date().toISOString()})`
  console.log(note)
  return { ok: true, simulated: true, note }
}