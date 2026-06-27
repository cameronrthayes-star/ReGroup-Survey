import { fEsc, isAdmin } from '../utils.js';
import { isOrientationComplete } from './orientation.js';
import { meetingBotBaseUrl } from './calendar.js';

export function renderHandbookChatCard(s) {
  if (!s) return '';

  if (!isOrientationComplete(s)) {
    return '<div class="card" style="margin-bottom:18px;">' +
      '<h3>Handbook Assistant</h3>' +
      '<div style="background:#f9fafb;border-radius:10px;padding:16px 18px;border:1px solid #e5e7eb;text-align:center;">' +
        '<div style="font-size:1.25em;margin-bottom:8px;">&#128274;</div>' +
        '<div style="font-size:0.88em;color:#6b7280;">Complete orientation to unlock the handbook assistant.</div>' +
      '</div>' +
    '</div>';
  }

  const defaultType = s.orientationType || 'staff';
  const typeLabel = defaultType === 'volunteer' ? 'Volunteer' : 'Staff';

  const typeControl = isAdmin()
    ? '<div style="margin-bottom:14px;">' +
        '<label for="hc-type" style="font-size:0.8em;color:#6b7280;display:block;margin-bottom:5px;">Handbook</label>' +
        '<select id="hc-type" style="font-size:0.9em;padding:8px 10px;border:1.5px solid #e5e7eb;border-radius:8px;background:#fff;min-width:160px;">' +
          '<option value="staff"' + (defaultType === 'staff' ? ' selected' : '') + '>Staff Handbook</option>' +
          '<option value="volunteer"' + (defaultType === 'volunteer' ? ' selected' : '') + '>Volunteer Handbook</option>' +
        '</select>' +
      '</div>'
    : '<select id="hc-type" style="display:none;" aria-hidden="true"><option value="' + fEsc(defaultType) + '" selected></option></select>' +
      '<div style="font-size:0.78em;color:#9ca3af;margin-bottom:12px;">' + fEsc(typeLabel) + ' handbook</div>';

  return '<div class="card" style="margin-bottom:18px;">' +
    '<h3>Handbook Assistant</h3>' +
    typeControl +
    '<div style="font-size:0.78em;color:#6b7280;margin-bottom:14px;padding:10px 12px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;line-height:1.5;">' +
      'This assistant answers from the approved handbook only. If the handbook does not answer your question, ask a supervisor or administrator.' +
    '</div>' +
    '<div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:10px;">' +
      '<textarea id="hc-question" placeholder="Ask a handbook question…" rows="2" ' +
        'style="flex:1;min-width:0;width:100%;padding:10px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:0.92em;resize:vertical;min-height:52px;font-family:inherit;box-sizing:border-box;line-height:1.5;" ' +
        'onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();sendHandbookQuestion();}"></textarea>' +
      '<button class="btn btn-primary" id="hc-send-btn" onclick="sendHandbookQuestion()" ' +
        'style="padding:10px 18px;min-height:44px;flex-shrink:0;align-self:flex-end;font-size:0.92em;">Ask</button>' +
    '</div>' +
    '<div id="hc-status" style="font-size:0.82em;margin-bottom:8px;display:none;"></div>' +
    '<div id="hc-answer-area" style="display:none;">' +
      '<div id="hc-answer" style="font-size:0.9em;color:#1f2937;line-height:1.6;margin-bottom:12px;padding:14px 16px;background:#f0f9ff;border-radius:10px;border:1px solid #bae6fd;word-break:break-word;overflow-wrap:break-word;white-space:pre-wrap;"></div>' +
      '<div id="hc-citations" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px;"></div>' +
    '</div>' +
  '</div>';
}

export async function sendHandbookQuestion() {
  const questionEl  = document.getElementById('hc-question');
  const statusEl    = document.getElementById('hc-status');
  const answerArea  = document.getElementById('hc-answer-area');
  const answerEl    = document.getElementById('hc-answer');
  const citationsEl = document.getElementById('hc-citations');
  const sendBtn     = document.getElementById('hc-send-btn');
  const typeEl      = document.getElementById('hc-type');

  if (!questionEl || !statusEl) return;

  const question = questionEl.value.trim();
  if (!question || question.length < 5) {
    statusEl.style.color = '#e53935';
    statusEl.textContent = 'Please enter a question (minimum 5 characters).';
    statusEl.style.display = 'block';
    return;
  }
  if (question.length > 1000) {
    statusEl.style.color = '#e53935';
    statusEl.textContent = 'Question is too long (maximum 1,000 characters).';
    statusEl.style.display = 'block';
    return;
  }

  const handbookType = (typeEl && typeEl.value) || 'staff';

  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '…'; }
  statusEl.style.color = '#6b7280';
  statusEl.textContent = 'Searching handbook…';
  statusEl.style.display = 'block';
  if (answerArea) answerArea.style.display = 'none';

  let data;
  try {
    const resp = await fetch(meetingBotBaseUrl() + '/api/ai/handbook-chat-public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, handbookType })
    });
    if (!resp.ok) {
      let errMsg = '';
      try { const e = await resp.json(); errMsg = (e && e.error) || ''; } catch (_) {}
      throw new Error(errMsg || 'Server error ' + resp.status);
    }
    data = await resp.json();
  } catch (err) {
    statusEl.style.color = '#e53935';
    statusEl.textContent = 'Error: ' + err.message;
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Ask'; }
    return;
  }

  statusEl.style.display = 'none';
  if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Ask'; }

  if (answerEl) answerEl.textContent = data.answer || '';

  if (citationsEl) {
    const cits = Array.isArray(data.citations) ? data.citations.filter(c => typeof c === 'string') : [];
    if (cits.length > 0) {
      citationsEl.innerHTML = cits.map(c =>
        '<span style="font-size:0.75em;padding:3px 9px;background:#e0f2fe;border-radius:12px;color:#0369a1;white-space:normal;word-break:break-word;">' +
          fEsc(c) +
        '</span>'
      ).join('');
    } else {
      citationsEl.innerHTML = '';
    }
  }

  if (answerArea) answerArea.style.display = 'block';
}
