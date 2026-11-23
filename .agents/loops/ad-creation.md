# Loop: Social ad creation (create only, no spend)

**Cadence:** weekly, Monday 10:00 IST. **Skills:** ad-creative, ads, copywriting, image.
**Purpose:** keep a fresh bench of tested-angle ads ready, so launching takes minutes.

**Acts when:** the bench has fewer than 6 ready ad drafts, or the owner added a new offer.

**Body**
1. Read `.agents/product-marketing.md` (audience, pain points, objections, customer language).
2. Write 3 angles × 2 variants for Meta and Google: headline, primary text, CTA, image brief in brand colours, UTM names. Each variant has a stated test hypothesis (metric, comparison, expected direction).
3. Self-check: claims match the product and the landing page; no "guaranteed" results; Indian audience and ₹ pricing are correct; passes the writing gate.
4. Save to `.agents/ads/drafts/<yyyy-mm-dd>-<angle>.md`. Mark `status: ready`.

**State:** `.agents/loops/ad-creation.log`; dedupe key = angle name.
**Stop / bail-out:** `STOP` file. **No ad account is connected, so this loop never launches or spends.** If one is connected later, add a hard daily and monthly ₹ cap and a per-run change limit before allowing launches (see guardrails).
**Output:** draft files and a one-line note in the weekly report.
