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
            content: `You MUST assign this case to 3 DIFFERENT attorneys from the EXACT list below.

CASE:
- Type: ${caseDetails.type}
- Client: ${caseDetails.client}
- Priority: ${caseDetails.priority}
- Value: $${caseDetails.value || 0}
- Summary: ${caseDetails.summary || 'N/A'}

ATTORNEYS YOU CAN CHOOSE FROM (pick 3 DIFFERENT ones):
${attorneys.map((a, i) => `${i + 1}. ${a}`).join('\n')}

TASK: Pick 3 DIFFERENT attorneys. The "attorney" field MUST contain EXACTLY ONE OF THE NAMES from the list above.

Return ONLY this JSON (no other text):
{
  "gold": {
    "attorney": "EXACT NAME from list above",
    "reasoning": "Why this attorney is best for this case"
  },
  "silver": {
    "attorney": "DIFFERENT NAME from list above (NOT gold)",
    "reasoning": "Why this attorney is a strong alternative"
  },
  "bronze": {
    "attorney": "DIFFERENT NAME from list above (NOT gold or silver)",
    "reasoning": "Why this attorney is solid"
  }
}

CRITICAL RULES:
1. "attorney" field MUST be an exact name from the list - do not make up names
2. All three must be DIFFERENT
3. Return ONLY the JSON, nothing else`
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
    
    // VALIDATE: Ensure all 3 are from the list and are different
    const gold = recommendations.gold.attorney;
    const silver = recommendations.silver.attorney;
    const bronze = recommendations.bronze.attorney;
    
    if (!attorneys.includes(gold)) {
      recommendations.gold.attorney = attorneys[0];
    }
    if (!attorneys.includes(silver) || silver === gold) {
      recommendations.silver.attorney = attorneys[1];
    }
    if (!attorneys.includes(bronze) || bronze === gold || bronze === silver) {
      recommendations.bronze.attorney = attorneys[2];
    }
    
    res.status(200).json(recommendations);
  } catch (error) {
    console.error('Recommendation error:', error);
    res.status(500).json({ error: error.message });
  }
}
