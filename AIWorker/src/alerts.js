let _sock = null

export function setAdminSocket(sock) {
  _sock = sock
}

export async function sendAdminAlert(message) {
  if (!_sock || !process.env.ADMIN_PHONE) return

  try {
    const jid = `${process.env.ADMIN_PHONE}@s.whatsapp.net`
    await _sock.sendMessage(jid, {
      text: `*[Sistema WA-AI]*\n${message}`
    })
    console.log('Alerta enviada al admin:', message.substring(0, 60))
  } catch (err) {
    console.error('No se pudo enviar alerta al admin:', err.message)
  }
}
