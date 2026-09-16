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
