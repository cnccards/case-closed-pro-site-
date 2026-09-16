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
