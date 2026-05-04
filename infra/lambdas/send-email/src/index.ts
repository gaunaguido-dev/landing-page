import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { Resend } from 'resend';

// ── SSM + Resend client (cached across warm invocations) ───────────────────

const ssm = new SSMClient({ region: process.env.AWS_REGION });
let resend: Resend | null = null;

async function getResend(): Promise<Resend> {
  if (resend) return resend;
  const cmd = new GetParameterCommand({
    Name:           process.env.RESEND_API_KEY_PARAM!,
    WithDecryption: true,
  });
  const { Parameter } = await ssm.send(cmd);
  if (!Parameter?.Value) throw new Error('RESEND_API_KEY_PARAM not found in SSM');
  resend = new Resend(Parameter.Value);
  return resend;
}

// ── Types ──────────────────────────────────────────────────────────────────

interface ContactPayload {
  name:     string;
  email:    string;
  company?: string;
  service?: string;
  message:  string;
}

// ── Config ─────────────────────────────────────────────────────────────────

const FROM_EMAIL     = process.env.FROM_EMAIL     || 'hola@g2techwork.com';
const TO_EMAIL       = process.env.TO_EMAIL       || 'hola@g2techwork.com';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const SERVICE_LABELS: Record<string, string> = {
  mvp:      'MVP en 90 Días',
  ai:       'Soluciones con IA',
  cloud:    'Arquitectura Cloud',
  software: 'Desarrollo a Medida',
  other:    'Otro / No estoy seguro',
};

// ── CORS headers ────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

// ── Handler ─────────────────────────────────────────────────────────────────

export const handler = async (event: AWSLambdaEvent) => {
  // Preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // Parse body
  let body: ContactPayload;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return respond(400, { error: 'Body JSON inválido.' });
  }

  // Validate required fields
  const { name, email, message, company, service } = body;
  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return respond(400, { error: 'Los campos name, email y message son requeridos.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respond(400, { error: 'El formato del email es inválido.' });
  }
  // Sanity length limits
  if (name.length > 100 || email.length > 200 || message.length > 4000) {
    return respond(400, { error: 'Uno o más campos exceden el largo máximo.' });
  }

  try {
    const client = await getResend();

    // Fire both emails in parallel
    await Promise.all([
      client.emails.send({
        from:    `g2techwork <${FROM_EMAIL}>`,
        to:      TO_EMAIL,
        subject: `📩 Nueva consulta de ${name.trim()}`,
        html:    buildNotificationEmail({ name, email, company, service, message }),
      }),
      client.emails.send({
        from:    `g2techwork <${FROM_EMAIL}>`,
        to:      email.trim(),
        replyTo: TO_EMAIL,
        subject: 'Recibimos tu consulta — g2techwork',
        html:    buildConfirmationEmail(name.trim()),
      }),
    ]);

    return respond(200, { success: true });
  } catch (err) {
    console.error('[send-email] Resend error:', err);
    return respond(500, { error: 'Error al enviar el mensaje. Intentá de nuevo más tarde.' });
  }
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function respond(statusCode: number, body: object) {
  return { statusCode, headers: corsHeaders, body: JSON.stringify(body) };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

// ── Email templates ──────────────────────────────────────────────────────────

function row(label: string, value: string): string {
  return `
  <tr>
    <td style="padding:11px 16px;font-size:11px;font-weight:700;color:#94A3B8;
               text-transform:uppercase;letter-spacing:.08em;white-space:nowrap;
               width:120px;background:#F8FAFC;border-bottom:1px solid #E2E8F0">${label}</td>
    <td style="padding:11px 16px;font-size:14px;color:#1E293B;
               border-bottom:1px solid #E2E8F0">${value}</td>
  </tr>`;
}

function step(num: string, text: string): string {
  return `
  <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">
    <span style="min-width:22px;height:22px;background:#00B8C4;color:#fff;
                 font-size:11px;font-weight:800;border-radius:50%;
                 display:inline-flex;align-items:center;justify-content:center;
                 flex-shrink:0">${num}</span>
    <span style="font-size:13px;color:#475569;line-height:1.55">${text}</span>
  </div>`;
}

function buildNotificationEmail(p: ContactPayload): string {
  const serviceLabel = p.service ? (SERVICE_LABELS[p.service] ?? p.service) : '—';
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:40px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0"
  style="background:#fff;border-radius:16px;overflow:hidden;
         box-shadow:0 4px 20px rgba(0,0,0,.08);max-width:600px;width:100%">

  <!-- Header -->
  <tr>
    <td style="background:#0B1F3A;padding:26px 36px">
      <span style="font-size:21px;font-weight:900;letter-spacing:-.03em;color:#fff">
        <span style="color:#00B8C4">g2</span>techwork
      </span>
    </td>
  </tr>
  <tr><td style="height:3px;background:linear-gradient(90deg,#00B8C4,#FF7A00)"></td></tr>

  <!-- Body -->
  <tr><td style="padding:32px 36px">
    <h1 style="margin:0 0 6px;font-size:20px;font-weight:800;color:#0B1F3A;letter-spacing:-.03em">
      📩 Nueva consulta de ${esc(p.name)}
    </h1>
    <p style="margin:0 0 24px;font-size:13px;color:#64748B">
      Recibiste un nuevo contacto a través del formulario del sitio.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0"
      style="border:1.5px solid #E2E8F0;border-radius:10px;overflow:hidden">
      ${row('Nombre',   esc(p.name))}
      ${row('Email',    `<a href="mailto:${esc(p.email)}" style="color:#00B8C4">${esc(p.email)}</a>`)}
      ${row('Empresa',  esc(p.company ?? '—'))}
      ${row('Servicio', serviceLabel)}
    </table>

    <div style="margin-top:20px;background:#F8FAFC;border-left:4px solid #00B8C4;
                border-radius:0 8px 8px 0;padding:14px 18px">
      <p style="margin:0 0 5px;font-size:10px;font-weight:700;color:#94A3B8;
                text-transform:uppercase;letter-spacing:.09em">Mensaje</p>
      <p style="margin:0;font-size:14px;color:#1E293B;line-height:1.7">${esc(p.message)}</p>
    </div>

    <div style="margin-top:26px;text-align:center">
      <a href="mailto:${esc(p.email)}"
        style="display:inline-block;background:#FF7A00;color:#fff;font-weight:700;
               font-size:14px;padding:13px 28px;border-radius:100px;text-decoration:none">
        Responder a ${esc(p.name)} →
      </a>
    </div>
  </td></tr>

  <!-- Footer -->
  <tr>
    <td style="background:#F8FAFC;padding:18px 36px;border-top:1px solid #E2E8F0">
      <p style="margin:0;font-size:11px;color:#94A3B8;text-align:center">
        g2techwork · Corrientes Capital, Argentina ·
        <a href="https://g2techwork.com" style="color:#00B8C4">g2techwork.com</a>
      </p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildConfirmationEmail(name: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:40px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0"
  style="background:#fff;border-radius:16px;overflow:hidden;
         box-shadow:0 4px 20px rgba(0,0,0,.08);max-width:600px;width:100%">

  <!-- Header -->
  <tr>
    <td style="background:#0B1F3A;padding:26px 36px;text-align:center">
      <span style="font-size:22px;font-weight:900;letter-spacing:-.03em;color:#fff">
        <span style="color:#00B8C4">g2</span>techwork
      </span>
    </td>
  </tr>
  <tr><td style="height:3px;background:linear-gradient(90deg,#00B8C4,#FF7A00)"></td></tr>

  <!-- Body -->
  <tr><td style="padding:40px 36px 32px;text-align:center">
    <div style="width:60px;height:60px;background:rgba(0,184,196,.1);border-radius:50%;
                margin:0 auto 18px;display:flex;align-items:center;justify-content:center;
                font-size:28px">✅</div>

    <h1 style="margin:0 0 10px;font-size:22px;font-weight:800;
               color:#0B1F3A;letter-spacing:-.03em">
      ¡Hola, ${esc(name)}!
    </h1>
    <p style="margin:0 0 24px;font-size:15px;color:#64748B;line-height:1.7;
              max-width:400px;margin-inline:auto">
      Recibimos tu consulta y nos pondremos en contacto
      <strong style="color:#0B1F3A">en menos de 24 horas</strong>.
    </p>

    <!-- Steps -->
    <table width="100%" cellpadding="0" cellspacing="0"
      style="background:#F8FAFC;border-radius:12px;margin:0 0 24px;text-align:left">
      <tr><td style="padding:18px 22px">
        <p style="margin:0 0 12px;font-size:10px;font-weight:700;color:#94A3B8;
                  text-transform:uppercase;letter-spacing:.09em">Qué sigue</p>
        ${step('1', 'Revisamos tu consulta en detalle')}
        ${step('2', 'Agendamos una llamada gratuita de 30 minutos')}
        ${step('3', 'Te presentamos un plan y presupuesto a medida')}
      </td></tr>
    </table>

    <a href="https://g2techwork.com"
      style="display:inline-block;background:#FF7A00;color:#fff;font-weight:700;
             font-size:14px;padding:13px 28px;border-radius:100px;text-decoration:none">
      Conocé más sobre g2techwork
    </a>

    <p style="margin:26px 0 0;font-size:13px;color:#94A3B8">
      ¿Tenés alguna duda urgente?<br>
      <a href="mailto:${TO_EMAIL}" style="color:#00B8C4;font-weight:600">${TO_EMAIL}</a>
    </p>
  </td></tr>

  <!-- Footer -->
  <tr>
    <td style="background:#F8FAFC;padding:18px 36px;border-top:1px solid #E2E8F0">
      <p style="margin:0;font-size:11px;color:#94A3B8;text-align:center">
        © ${new Date().getFullYear()} g2techwork · Corrientes Capital, Argentina
      </p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Minimal Lambda event type ─────────────────────────────────────────────────

interface AWSLambdaEvent {
  body?: string;
  requestContext?: {
    http?: { method: string };
  };
}
