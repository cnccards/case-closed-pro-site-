# 🔧 API CODE - READY TO COPY-PASTE

**Just copy each section and paste into the corresponding file in GitHub**

---

## **FILE 1: `/api/recommend-attorney.js`**

Copy everything below and paste into this file:

```javascript
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { caseDetails, attorneys } = req.body;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [
          {
            role: 'user',
            content: `You are a litigation firm partner recommending the top 3 attorneys for a case.

CASE DETAILS:
- Client: ${caseDetails.client}
- Type: ${caseDetails.type}
- Priority: ${caseDetails.priority}
- Estimated Value: $${caseDetails.value || 0}
- Summary: ${caseDetails.summary || 'N/A'}

AVAILABLE ATTORNEYS:
${attorneys.map(a => `- ${a}`).join('\n')}

Based on the case type, complexity, value, and priority, recommend the TOP 3 attorneys to handle this case. Consider:
1. Specialization in this case type
2. Case complexity and value (senior attorneys for high-value cases)
3. Priority level matching attorney's experience
4. Best overall fit vs good alternatives

Return ONLY this JSON (no markdown, no explanation):
{
  "gold": {
    "attorney": "First Choice Attorney Name",
    "reasoning": "Why this attorney is the BEST fit for this specific case"
  },
  "silver": {
    "attorney": "Second Choice Attorney Name",
    "reasoning": "Why this attorney is a strong alternative"
  },
  "bronze": {
    "attorney": "Third Choice Attorney Name",
    "reasoning": "Why this attorney is a solid option"
  }
}

CRITICAL: Return ONLY valid JSON. All three must be different attorneys.`
          }
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();
    const responseText = data.content[0]?.text || '';
    
    let cleanJson = responseText.trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    }

    const recommendations = JSON.parse(cleanJson);
    res.status(200).json(recommendations);
  } catch (error) {
    console.error('Recommendation error:', error);
    res.status(500).json({ error: error.message });
  }
}
```

---

## **FILE 2: `/api/settlement-recommendation.js`**

Copy everything below and paste into this file:

```javascript
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { caseDetails } = req.body;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: `You are a litigation settlement expert analyzing settlement negotiations.

CASE DETAILS:
- Client: ${caseDetails.client}
- Type: ${caseDetails.type}
- Value: $${caseDetails.value || 0}
- Reserve: $${caseDetails.reserve || 0}
- Priority: ${caseDetails.priority}
- Judge: ${caseDetails.judge || 'Unknown'}
- Opposing Counsel: ${caseDetails.opposingCounsel || 'Unknown'}
- Summary: ${caseDetails.summary || 'N/A'}
- Current Demand: ${caseDetails.currentDemand ? '$' + caseDetails.currentDemand : 'N/A'}

Analyze this settlement and provide recommendations:

Return ONLY this JSON (no markdown, no explanation):
{
  "counterOffer": numeric value,
  "expectedRange": {
    "low": numeric value,
    "high": numeric value
  },
  "walkAwayPoint": numeric value,
  "reasoning": "2-3 sentence reasoning for these numbers",
  "strategy": "Your negotiation strategy",
  "timeline": "When to push vs when to compromise"
}

CRITICAL: Return ONLY valid JSON.`
          }
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();
    const responseText = data.content[0]?.text || '';
    
    let cleanJson = responseText.trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    }

    const recommendation = JSON.parse(cleanJson);
    res.status(200).json(recommendation);
  } catch (error) {
    console.error('Settlement error:', error);
    res.status(500).json({ error: error.message });
  }
}
```

---

## **FILE 3: `/api/risk-analysis.js`**

Copy everything below and paste into this file:

```javascript
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { caseDetails } = req.body;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: `You are a litigation risk analyst. Analyze this case for hidden risks and problems.

CASE DETAILS:
- Client: ${caseDetails.client}
- Type: ${caseDetails.type}
- Value: $${caseDetails.value || 0}
- Priority: ${caseDetails.priority}
- Summary: ${caseDetails.summary || 'N/A'}

Identify specific risks and provide mitigation strategies.

Return ONLY this JSON (no markdown, no explanation):
{
  "riskScore": number between 1-10,
  "risks": [
    {
      "risk": "Risk description",
      "probability": "Probability percentage",
      "impact": "Impact level (LOW/MEDIUM/HIGH)"
    }
  ],
  "mitigations": [
    {
      "action": "Specific action to reduce risk",
      "effectiveness": "How much this reduces overall risk"
    }
  ],
  "recommendation": "Overall recommendation (e.g., push for settlement by month 4)",
  "reasoning": "2-3 sentence explanation"
}

CRITICAL: Return ONLY valid JSON.`
          }
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();
    const responseText = data.content[0]?.text || '';
    
    let cleanJson = responseText.trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    }

    const analysis = JSON.parse(cleanJson);
    res.status(200).json(analysis);
  } catch (error) {
    console.error('Risk analysis error:', error);
    res.status(500).json({ error: error.message });
  }
}
```

---

## **FILE 4: `/api/strategy-prediction.js`**

Copy everything below and paste into this file:

```javascript
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { caseDetails, opposingCounsel } = req.body;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: `You are a litigation strategist analyzing opposing counsel behavior.

OPPOSING COUNSEL: ${opposingCounsel}

CASE DETAILS:
- Type: ${caseDetails.type}
- Value: $${caseDetails.value || 0}
- Summary: ${caseDetails.summary || 'N/A'}

Based on typical patterns for opposing counsel in cases like this, predict their strategy and provide counter-strategies.

Return ONLY this JSON (no markdown, no explanation):
{
  "opposingStrategy": "What they will likely do",
  "predictions": [
    {
      "tactic": "Specific tactic they'll use",
      "probability": "Probability as percentage",
      "difficulty": "How difficult to counter (LOW/MEDIUM/HIGH)"
    }
  ],
  "counterStrategies": [
    {
      "strategy": "Your counter-move",
      "effectiveness": "How effective this is"
    }
  ],
  "settlementProbability": "Likelihood they'll settle early",
  "successProbability": "Your success probability if you follow this strategy",
  "reasoning": "2-3 sentence explanation"
}

CRITICAL: Return ONLY valid JSON.`
          }
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();
    const responseText = data.content[0]?.text || '';
    
    let cleanJson = responseText.trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    }

    const prediction = JSON.parse(cleanJson);
    res.status(200).json(prediction);
  } catch (error) {
    console.error('Strategy prediction error:', error);
    res.status(500).json({ error: error.message });
  }
}
```

---

## **FILE 5: `/api/timeline-prediction.js`**

Copy everything below and paste into this file:

```javascript
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { caseDetails } = req.body;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: `You are a litigation timeline and cost analyst.

CASE DETAILS:
- Type: ${caseDetails.type}
- Value: $${caseDetails.value || 0}
- Current Stage: ${caseDetails.stage || 'Pleadings'}
- Jurisdiction: ${caseDetails.jurisdiction || 'Unknown'}
- Summary: ${caseDetails.summary || 'N/A'}

Predict case timeline and costs.

Return ONLY this JSON (no markdown, no explanation):
{
  "timelineProbabilities": {
    "month12": "Probability as percentage",
    "month18": "Probability as percentage",
    "month24": "Probability as percentage"
  },
  "mostLikely": "Most likely closure month",
  "costEstimates": {
    "conservative": numeric value,
    "midRange": numeric value,
    "highEnd": numeric value
  },
  "mostLikelyCost": numeric value,
  "costBreakdown": {
    "discovery": "Percentage and description",
    "experts": "Percentage and description",
    "trialPrep": "Percentage and description"
  },
  "costReductions": [
    {
      "action": "How to reduce cost",
      "savings": "Dollar amount saved"
    }
  ],
  "reasoning": "2-3 sentence explanation"
}

CRITICAL: Return ONLY valid JSON.`
          }
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();
    const responseText = data.content[0]?.text || '';
    
    let cleanJson = responseText.trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    }

    const prediction = JSON.parse(cleanJson);
    res.status(200).json(prediction);
  } catch (error) {
    console.error('Timeline prediction error:', error);
    res.status(500).json({ error: error.message });
  }
}
```

---

## **HOW TO ADD TO GITHUB (Quick Version)**

1. Go to your GitHub repo
2. For each file, click "Add file" → "Create new file"
3. Name it (e.g., `api/recommend-attorney.js`)
4. Paste the code from above
5. Click "Commit changes"

Or use git locally:
```bash
# Copy case-closed-pro.html
cp /mnt/user-data/outputs/case-closed-pro.html ./

# Create API files and paste code above
mkdir -p api
# Then create each .js file with the code above

git add .
git commit -m "Add all 5 proprietary AI features"
git push origin main
```

---

**That's it! All code is ready to go.** 🚀
