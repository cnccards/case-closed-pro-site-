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
