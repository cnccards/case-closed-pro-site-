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
