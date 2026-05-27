/**
 * Edge Function: agent_admin
 *
 * Provee dos endpoints internos para Noe (admin de Justo Makario):
 *   POST /functions/v1/agent_admin/ocr   — OCR de comprobante con Claude Haiku 4.5
 *   POST /functions/v1/agent_admin/chat  — Asistente conversacional con Sonnet 4.6
 *
 * Patron de seguridad identico a invite_user/index.ts:
 *   - Validacion JWT del caller via Authorization header.
 *   - Gate por rol (owner/admin) consultando profiles via service-role.
 *   - Service-role client para storage.download y persistencia en agent_conversations.
 *
 * Secret requerido (Supabase Dashboard → Edge Functions → Secrets):
 *   ANTHROPIC_API_KEY
 *
 * Modelos:
 *   - OCR  : claude-haiku-4-5-20251001
 *   - Chat : claude-sonnet-4-6
 *
 * Prompt caching: system prompts marcados con cache_control: ephemeral
 * para amortizar tokens de input entre llamadas.
 *
 * Errores:
 *   - 401: sin JWT o sesion invalida.
 *   - 403: rol no autorizado.
 *   - 400: payload invalido.
 *   - 404: action desconocida (ni /ocr ni /chat).
 *   - 502: upstream Supabase (storage/db) fallo.
 *   - 503: Anthropic API no responde o devolvio error.
 *   - 500: error interno inesperado.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const MODEL_OCR = 'claude-haiku-4-5-20251001';
const MODEL_CHAT = 'claude-sonnet-4-6';

const SYSTEM_OCR = `Sos un asistente de administracion de Macario (Justo Makario,
empresa de muebles, Argentina). Te paso una foto o PDF de un comprobante
argentino (factura A/B/C/M, nota de credito, nota de debito, recibo o ticket).
Extrae los campos solicitados y devolve UN UNICO objeto JSON valido, sin
texto adicional, sin markdown, sin code fences.

Schema de respuesta (JSON estricto, sin claves adicionales):
{
  "tipo_comprobante":         "factura" | "nota_credito" | "nota_debito" | "recibo" | "ticket" | null,
  "clase_comprobante":        "A" | "B" | "C" | "M" | null,
  "condicion_comprobante":    "original" | "duplicado" | null,
  "punto_venta":              string | null,
  "numero_comprobante":       string | null,
  "fecha_emision":            string | null,
  "fecha_vencimiento":        string | null,
  "cae":                      string | null,

  "proveedor_razon_social":   string | null,
  "proveedor_cuit":           string | null,
  "proveedor_condicion_iva":  "RI" | "Monotributo" | "Exento" | "Consumidor" | string | null,

  "subtotal_neto":            number | null,
  "iva_pct":                  21 | 10.5 | 27 | 0 | null,
  "iva_monto":                number | null,
  "otros_tributos_desc":      string | null,
  "otros_tributos_pct":       number | null,
  "otros_tributos_monto":     number | null,
  "monto_total":              number | null,

  "condicion_pago":           "contado" | "cuenta_corriente" | "financiado" | "otro" | null,
  "categoria_sugerida":       "materiales_insumos" | "fletes" | "logistica_flex" | "correo_encomiendas" | "gastos_fijos" | "honorarios" | "servicios" | "intereses_financiacion" | "sueldos" | "impuestos" | "otros" | null,
  "concepto_libre":           string | null,

  "items": [
    {
      "cantidad":         number,
      "codigo":           string | null,
      "descripcion":      string,
      "precio_unit":      number,
      "bonificacion_pct": number | null,
      "subtotal":         number,
      "iva_pct":          number,
      "importe":          number
    }
  ]
}

Reglas:
- Devolve ÚNICAMENTE el JSON, sin texto antes ni despues, sin markdown.
- Si un campo no aparece claramente en el comprobante, devolve null. NO inventes datos.
- Numericos en ARS, sin separador de miles, sin signo de pesos. Usa punto decimal.
- Fechas en formato ISO YYYY-MM-DD.
- CUIT en formato XX-XXXXXXXX-X (con guiones).
- "tipo_comprobante": "factura" cubre Facturas A/B/C/M (la clase va en clase_comprobante).
- "clase_comprobante": solo si tipo_comprobante='factura'; si no, null.
- "condicion_pago" inferilo del contexto del comprobante:
    · "Cuenta corriente", "Cta cte", "Cta. Cte." → "cuenta_corriente"
    · "Contado", "Efectivo", "Al contado" → "contado"
    · "Financiado en N cuotas", "Plan cuotas" → "financiado"
    · Si no es claro, null.
- "items": extrae TODOS los productos/servicios de la grilla del comprobante.
   Si no hay grilla de items, devolve array vacio [].
   subtotal = cantidad * precio_unit * (1 - bonificacion_pct/100).
   importe = subtotal * (1 + iva_pct/100).
- "categoria_sugerida": elegi SOLO entre los 11 valores listados. Guia:
    · materiales_insumos: materias primas (madera, melamina, herrajes, tornillos, telgopor, pegamentos).
    · fletes: transporte de mercaderia, camion, mudanza.
    · logistica_flex: pagos a Mercado Libre Logistica Flex.
    · correo_encomiendas: Correo Argentino, OCA, Andreani, Via Cargo.
    · gastos_fijos: alquiler, luz, gas, internet, agua, ABL.
    · honorarios: contador, abogado, asesor, consultor.
    · servicios: limpieza, mantenimiento, reparaciones, software SaaS.
    · intereses_financiacion: intereses bancarios, costo financiero, adelanto de dinero.
    · sueldos: pagos a empleados, jornales, aguinaldo, vacaciones.
    · impuestos: IIBB, IVA, Ganancias, Sellos, AFIP, ARCA, municipales.
    · otros: cuando no encaja claramente en ninguna de las anteriores.`;

const SYSTEM_CHAT = `Sos el asistente de administracion de Macario, empresa
de muebles argentina (Justo Makario). Tu usuaria principal se llama Noe y
se ocupa de finanzas, proveedores, clientes mayoristas, cheques, cuentas
corrientes. Respondes en castellano rioplatense, breve, claro y al grano.

Reglas:
- Si no sabes algo, decilo. No inventes saldos, montos ni datos.
- Si la consulta requiere informacion de la base (saldos, listados),
  sugieri a la usuaria que abra la pestaña correspondiente (Proveedores,
  Clientes, Cheques, Egresos) donde encontrara los datos actualizados.
- Para preguntas operativas (como cargar un gasto, emitir un cheque, etc.)
  explica el flujo paso a paso en la UI.
- No mostras URIs internas ni tokens.`;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');

    if (!anthropicKey) {
      return jsonRes({ error: 'Server config error: missing ANTHROPIC_API_KEY' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonRes({ error: 'Falta token de autorizacion' }, 401);
    }

    // Validar caller con su JWT
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return jsonRes({ error: 'Sesion invalida' }, 401);
    }

    // Validar rol del caller con service-role (bypassa RLS)
    const admin = createClient(supabaseUrl, serviceRole);
    const { data: profile, error: profErr } = await admin
      .from('profiles')
      .select('role, active')
      .eq('id', userData.user.id)
      .single();

    if (profErr || !profile || !profile.active) {
      return jsonRes({ error: 'Profile no encontrado o inactivo' }, 403);
    }
    if (!['owner', 'admin'].includes(profile.role)) {
      return jsonRes({ error: 'Solo owner/admin pueden usar este endpoint' }, 403);
    }

    // Routing por path
    const url = new URL(req.url);
    const segments = url.pathname.split('/').filter((s) => s.length > 0);
    const action = segments[segments.length - 1];

    if (action === 'ocr') {
      return await handleOCR(req, admin, anthropicKey);
    }
    if (action === 'chat') {
      return await handleChat(req, admin, anthropicKey, userData.user.id);
    }

    return jsonRes({ error: `Unknown action: ${action}. Use /ocr or /chat` }, 404);
  } catch (e) {
    return jsonRes({ error: (e as Error).message }, 500);
  }
});

// ════════════════════════════════════════════════════════════════════
// OCR endpoint
// ════════════════════════════════════════════════════════════════════
async function handleOCR(req: Request, admin: SupabaseClient, anthropicKey: string) {
  let body: { receipt_url?: string; hint?: string };
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: 'Payload JSON invalido' }, 400);
  }

  if (!body.receipt_url) {
    return jsonRes({ error: 'Falta receipt_url' }, 400);
  }

  // Normalizar path: aceptamos "admin_receipts/xxx" o "xxx" sin prefijo.
  let path = String(body.receipt_url).trim();
  const prefix = 'admin_receipts/';
  if (path.startsWith(prefix)) path = path.slice(prefix.length);
  if (path.startsWith('/')) path = path.slice(1);

  const { data: fileData, error: dlErr } = await admin.storage
    .from('admin_receipts')
    .download(path);

  if (dlErr || !fileData) {
    return jsonRes(
      { error: 'No se pudo leer el comprobante', detail: dlErr?.message },
      502,
    );
  }

  // Convertir a base64 en chunks (evita stack overflow en archivos grandes).
  const arrayBuffer = await fileData.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  const base64 = btoa(binary);
  const mediaType = fileData.type || 'image/jpeg';

  // Claude vision soporta "image" para jpeg/png/webp/gif y "document" para pdf.
  const isPdf = mediaType === 'application/pdf';
  const content: unknown[] = [
    {
      type: isPdf ? 'document' : 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: base64,
      },
    },
    {
      type: 'text',
      text: `Hint del usuario: ${body.hint || '(ninguno)'}\n\nExtrae los campos y devuelve SOLO el JSON.`,
    },
  ];

  let claudeRes: Response;
  try {
    claudeRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL_OCR,
        max_tokens: 1024,
        system: [
          {
            type: 'text',
            text: SYSTEM_OCR,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content }],
      }),
    });
  } catch (e) {
    return jsonRes(
      { error: 'Anthropic API unreachable', detail: (e as Error).message },
      503,
    );
  }

  if (!claudeRes.ok) {
    const errText = await claudeRes.text();
    return jsonRes(
      { error: 'Anthropic API error', status: claudeRes.status, detail: errText },
      503,
    );
  }

  const claudeData = await claudeRes.json();
  const textBlock = (claudeData.content || []).find(
    (c: { type: string }) => c.type === 'text',
  );
  if (!textBlock || !textBlock.text) {
    return jsonRes(
      { error: 'Respuesta de Claude sin texto', raw: claudeData },
      502,
    );
  }

  // Sanear fences markdown si el modelo los agrego.
  let extracted: Record<string, unknown> = {};
  const cleaned = String(textBlock.text)
    .replace(/^```json\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    extracted = JSON.parse(cleaned);
  } catch (e) {
    return jsonRes(
      {
        error: 'Claude no devolvio JSON valido',
        raw_text: textBlock.text,
        parse_error: (e as Error).message,
      },
      502,
    );
  }

  // Re-emit todos los campos del schema S2.3. Defaults a null si Claude
  // los omitio. items default a [] (la columna en BD es NOT NULL DEFAULT '[]').
  return jsonRes(
    {
      tipo_comprobante:        extracted.tipo_comprobante        ?? null,
      clase_comprobante:       extracted.clase_comprobante       ?? null,
      condicion_comprobante:   extracted.condicion_comprobante   ?? null,
      punto_venta:             extracted.punto_venta             ?? null,
      numero_comprobante:      extracted.numero_comprobante      ?? null,
      fecha_emision:           extracted.fecha_emision           ?? null,
      fecha_vencimiento:       extracted.fecha_vencimiento       ?? null,
      cae:                     extracted.cae                     ?? null,

      proveedor_razon_social:  extracted.proveedor_razon_social  ?? null,
      proveedor_cuit:          extracted.proveedor_cuit          ?? null,
      proveedor_condicion_iva: extracted.proveedor_condicion_iva ?? null,

      subtotal_neto:           extracted.subtotal_neto           ?? null,
      iva_pct:                 extracted.iva_pct                 ?? null,
      iva_monto:               extracted.iva_monto               ?? null,
      otros_tributos_desc:     extracted.otros_tributos_desc     ?? null,
      otros_tributos_pct:      extracted.otros_tributos_pct      ?? null,
      otros_tributos_monto:    extracted.otros_tributos_monto    ?? null,
      monto_total:             extracted.monto_total             ?? null,

      condicion_pago:          extracted.condicion_pago          ?? null,
      categoria_sugerida:      extracted.categoria_sugerida      ?? null,
      concepto_libre:          extracted.concepto_libre          ?? null,

      items:                   Array.isArray(extracted.items) ? extracted.items : [],

      ocr_raw_json: claudeData,
    },
    200,
  );
}

// ════════════════════════════════════════════════════════════════════
// Chat endpoint
// ════════════════════════════════════════════════════════════════════
async function handleChat(
  req: Request,
  admin: SupabaseClient,
  anthropicKey: string,
  userId: string,
) {
  let body: {
    messages?: Array<{ role: string; content: string }>;
    conversation_id?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: 'Payload JSON invalido' }, 400);
  }

  const newMessages = Array.isArray(body.messages) ? body.messages : [];
  let conversationId: string | null = body.conversation_id || null;
  if (newMessages.length === 0) {
    return jsonRes({ error: 'messages[] requerido' }, 400);
  }

  // Cargar historial si hay conversation_id
  let history: Array<{ role: string; content: string }> = [];
  let priorTokensIn = 0;
  let priorTokensOut = 0;
  if (conversationId) {
    const { data, error } = await admin
      .from('agent_conversations')
      .select('mensajes, tokens_in, tokens_out')
      .eq('id', conversationId)
      .maybeSingle();
    if (error) {
      return jsonRes(
        { error: 'No se pudo cargar conversation', detail: error.message },
        502,
      );
    }
    if (data) {
      history = (data.mensajes || []) as Array<{ role: string; content: string }>;
      priorTokensIn = data.tokens_in || 0;
      priorTokensOut = data.tokens_out || 0;
    }
  }

  const claudeMessages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    ...newMessages.map((m) => ({ role: m.role, content: m.content })),
  ];

  let claudeRes: Response;
  try {
    claudeRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL_CHAT,
        max_tokens: 2048,
        system: [
          {
            type: 'text',
            text: SYSTEM_CHAT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: claudeMessages,
      }),
    });
  } catch (e) {
    return jsonRes(
      { error: 'Anthropic API unreachable', detail: (e as Error).message },
      503,
    );
  }

  if (!claudeRes.ok) {
    const errText = await claudeRes.text();
    return jsonRes(
      { error: 'Anthropic API error', status: claudeRes.status, detail: errText },
      503,
    );
  }

  const claudeData = await claudeRes.json();
  const textBlock = (claudeData.content || []).find(
    (c: { type: string }) => c.type === 'text',
  );
  const replyText: string = textBlock?.text || '';
  const tokensInThisCall: number = claudeData.usage?.input_tokens || 0;
  const tokensOutThisCall: number = claudeData.usage?.output_tokens || 0;

  // Persistir conversacion
  const ts = new Date().toISOString();
  const updatedMessages = [
    ...history,
    ...newMessages.map((m) => ({ role: m.role, content: m.content, ts })),
    { role: 'assistant', content: replyText, ts },
  ];

  if (conversationId) {
    const { error: upErr } = await admin
      .from('agent_conversations')
      .update({
        mensajes: updatedMessages,
        tokens_in: priorTokensIn + tokensInThisCall,
        tokens_out: priorTokensOut + tokensOutThisCall,
      })
      .eq('id', conversationId);
    if (upErr) {
      return jsonRes(
        { error: 'No se pudo guardar conversation', detail: upErr.message },
        502,
      );
    }
  } else {
    const { data: ins, error: insErr } = await admin
      .from('agent_conversations')
      .insert({
        user_id: userId,
        mensajes: updatedMessages,
        tokens_in: tokensInThisCall,
        tokens_out: tokensOutThisCall,
        modelo: MODEL_CHAT,
      })
      .select('id')
      .single();
    if (insErr || !ins) {
      return jsonRes(
        { error: 'No se pudo crear conversation', detail: insErr?.message },
        502,
      );
    }
    conversationId = ins.id;
  }

  return jsonRes(
    {
      reply: replyText,
      tokens_in: tokensInThisCall,
      tokens_out: tokensOutThisCall,
      conversation_id: conversationId,
    },
    200,
  );
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
