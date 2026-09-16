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
