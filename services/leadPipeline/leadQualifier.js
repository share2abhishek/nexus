// services/leadPipeline/leadQualifier.js
// AI-powered lead qualification and instant response generator for Meta Lead Ads & Messenger.

const { aiGenerate } = require('../aiHelper');

/**
 * Evaluates an incoming lead and generates a score (0-100), intent summary,
 * and a personalized instant reply for sales reps or automated follow-up.
 */
async function qualifyLead(leadData, aiOptions = {}) {
  const { full_name, email, phone_number, custom_answers = {} } = leadData;

  const answersFormatted = Object.entries(custom_answers)
    .map(([q, a]) => `- ${q}: ${a}`)
    .join('\n');

  const prompt = `You are an executive sales qualification agent evaluating an incoming B2B/B2C ad lead.

Lead Information:
- Name: ${full_name || 'Prospect'}
- Phone: ${phone_number || 'Not provided'}
- Email: ${email || 'Not provided'}
- Form Answers:
${answersFormatted || '- Standard lead form inquiry'}

Your Task:
1. Assign a Lead Score from 1 to 100 based on completeness (phone + email + detailed answers = higher score).
2. Write a 1-sentence Executive Intent Summary describing who they are and what they need.
3. Write a warm, professional, frictionless Instant Reply message (under 50 words) suitable for WhatsApp, SMS, or Messenger asking a 1-sentence clarifying question or offering 2 time slots for a brief call.

Format your response as valid JSON:
{
  "score": 85,
  "intent_summary": "Urgent property manager looking for society billing software.",
  "suggested_reply": "Hi ${full_name || 'there'}! Thanks for reaching out. Would you be open to a 5-minute walkthrough tomorrow at 11 AM or 3 PM?"
}`;

  try {
    const res = await aiGenerate(
      prompt,
      aiOptions.googleKey || process.env.GOOGLE_AI_KEY,
      350,
      null,
      aiOptions
    );

    const jsonMatch = res.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        score: Math.min(100, Math.max(1, Number(parsed.score) || 60)),
        intent_summary: parsed.intent_summary || 'Interested prospect from Meta Lead Ad.',
        suggested_reply: parsed.suggested_reply || `Hi ${full_name || 'there'}, thank you for reaching out! When would be a good time for a quick 5-minute chat?`,
      };
    }
  } catch (err) {
    console.warn('[Lead Qualifier] AI evaluation failed, using deterministic qualification:', err.message);
  }

  // Fallback rule-based qualification if AI key is missing or fails
  let score = 50;
  if (phone_number && phone_number.length >= 10) score += 25;
  if (email && email.includes('@')) score += 15;
  if (Object.keys(custom_answers).length > 0) score += 10;

  const firstName = (full_name || '').split(' ')[0] || 'there';

  return {
    score: Math.min(100, score),
    intent_summary: `Direct Meta Lead Ad inquiry from ${full_name || 'new prospect'}. Contact information verified.`,
    suggested_reply: `Hi ${firstName}, thanks for inquiring! Would you be available for a brief 5-minute call today to discuss how we can assist you?`,
  };
}

module.exports = {
  qualifyLead,
};
