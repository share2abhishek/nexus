// API Routes: AI Chat Knowledge Base
// Endpoints for managing, testing, generating, importing, and exporting
// business knowledge for WhatsApp & Website live chat.

const express = require('express');
const knowledgeBase = require('../services/knowledgeBase');

module.exports = (knex, requirePermission) => {
  const router = express.Router();

  // GET /api/knowledge-base — Fetch active knowledge base
  router.get('/', requirePermission('content.view'), async (req, res) => {
    try {
      const data = await knowledgeBase.getKnowledgeBase(knex, req.workspaceId);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/knowledge-base — Save and sync knowledge base
  router.post('/', requirePermission('content.edit'), async (req, res) => {
    try {
      const saved = await knowledgeBase.saveKnowledgeBase(
        knex,
        req.workspaceId,
        req.session?.userId,
        req.body || {}
      );
      res.json({ success: true, ...saved });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/knowledge-base/simulate — Live test simulator
  router.post('/simulate', requirePermission('content.view'), async (req, res) => {
    try {
      const { message, visitorName, history, model } = req.body || {};
      if (!message || !String(message).trim()) {
        return res.status(400).json({ error: 'Please enter a message to test.' });
      }
      const result = await knowledgeBase.simulateChat(
        knex,
        req.workspaceId,
        req.session?.userId,
        { message, visitorName, history, model }
      );
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/knowledge-base/generate-faqs — AI FAQ generator
  router.post('/generate-faqs', requirePermission('content.create'), async (req, res) => {
    try {
      const { topic, count, existingText } = req.body || {};
      const faqs = await knowledgeBase.aiGenerateFaqs(
        knex,
        req.workspaceId,
        req.session?.userId,
        { topic, count, existingText }
      );
      res.json({ success: true, faqs });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/knowledge-base/format-notes — AI Text structuring
  router.post('/format-notes', requirePermission('content.create'), async (req, res) => {
    try {
      const { rawText } = req.body || {};
      const structured = await knowledgeBase.aiFormatNotes(
        knex,
        req.workspaceId,
        req.session?.userId,
        { rawText }
      );
      res.json({ success: true, ...structured });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/knowledge-base/import — Import FAQs from JSON or CSV
  router.post('/import', requirePermission('content.edit'), async (req, res) => {
    try {
      const { faqs = [], append = true } = req.body || {};
      const current = await knowledgeBase.getKnowledgeBase(knex, req.workspaceId);
      let combinedFaqs = append ? [...(current.faqs || [])] : [];

      const toAdd = Array.isArray(faqs) ? faqs.map((f, idx) => ({
        id: `faq_imp_${Date.now()}_${idx}`,
        category: String(f.category || 'General').trim().slice(0, 50),
        question: String(f.question || '').trim().slice(0, 500),
        answer: String(f.answer || '').trim().slice(0, 2000),
        tags: Array.isArray(f.tags) ? f.tags.map(t => String(t).trim().toLowerCase()) : [],
        enabled: true,
      })).filter(f => f.question && f.answer) : [];

      combinedFaqs.push(...toAdd);

      const saved = await knowledgeBase.saveKnowledgeBase(
        knex,
        req.workspaceId,
        req.session?.userId,
        { ...current, faqs: combinedFaqs }
      );

      res.json({ success: true, imported_count: toAdd.length, ...saved });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/knowledge-base/export — Export FAQs as JSON or CSV
  router.get('/export', requirePermission('content.view'), async (req, res) => {
    try {
      const format = String(req.query.format || 'json').toLowerCase();
      const current = await knowledgeBase.getKnowledgeBase(knex, req.workspaceId);

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="ai-knowledge-base.csv"');
        const rows = [['Category', 'Question', 'Answer', 'Tags', 'Enabled']];
        for (const f of current.faqs || []) {
          rows.push([
            `"${(f.category || '').replace(/"/g, '""')}"`,
            `"${(f.question || '').replace(/"/g, '""')}"`,
            `"${(f.answer || '').replace(/"/g, '""')}"`,
            `"${(f.tags || []).join(', ').replace(/"/g, '""')}"`,
            f.enabled !== false ? 'true' : 'false',
          ]);
        }
        return res.send(rows.map(r => r.join(',')).join('\n'));
      }

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="ai-knowledge-base.json"');
      res.json({
        workspace_id: req.workspaceId,
        exported_at: new Date().toISOString(),
        persona: current.persona,
        facts: current.facts,
        faqs: current.faqs,
        documents: current.documents,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
