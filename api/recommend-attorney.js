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
            content: `You are a litigation firm partner recommending the top 3 DIFFERENT attorneys for a case.

CASE DETAILS:
- Client: ${caseDetails.client}
- Type: ${caseDetails.type}
- Priority: ${caseDetails.priority}
- Estimated Value: $${caseDetails.value || 0}
- Summary: ${caseDetails.summary || 'N/A'}

AVAILABLE ATTORNEYS (choose 3 DIFFERENT ones from this list):
${attorneys.map((a, i) => `${i + 1}. ${a}`).join('\n')}

Your task: Recommend the TOP 3 DIFFERENT attorneys to handle this case.

CRITICAL REQUIREMENTS:
1. Gold, Silver, and Bronze MUST be THREE DIFFERENT ATTORNEYS
2. Do NOT recommend the same attorney twice
3. Consider specialization, case complexity, value, and priority
4. Each attorney must have different reasoning

Return ONLY this JSON (no markdown, no explanation, no preamble):
{
  "gold": {
    "attorney": "DIFFERENT attorney name from the list",
    "reasoning": "Why this attorney is BEST for this case type and value"
  },
  "silver": {
    "attorney": "DIFFERENT attorney name (NOT the gold choice)",
    "reasoning": "Why this is a strong alternative"
  },
  "bronze": {
    "attorney": "DIFFERENT attorney name (NOT gold or silver)",
    "reasoning": "Why this is a solid option"
  }
}

MANDATORY: All three attorney names MUST be different. If you return the same name twice, you have failed.`
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
    
    // Validation: Ensure all 3 attorneys are different
    const goldAtty = recommendations.gold?.attorney;
    const silverAtty = recommendations.silver?.attorney;
    const bronzeAtty = recommendations.bronze?.attorney;
    
    if (goldAtty === silverAtty || goldAtty === bronzeAtty || silverAtty === bronzeAtty) {
      throw new Error('API returned duplicate attorneys - validation failed');
    }
    
    res.status(200).json(recommendations);
  } catch (error) {
    console.error('Recommendation error:', error);
    res.status(500).json({ error: error.message });
  }
}
