export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { claimText } = req.body;

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
            content: `You are an expert litigation assistant. Extract key information and return ONLY valid JSON.

CLAIM DETAILS:
${claimText}

Return ONLY this JSON structure:
{
  "client": "Company name",
  "type": "Insurance Defense|Personal Injury|Contract Dispute|Employment Law|Product Liability|Premises Liability|Medical Malpractice|IP Litigation|Property Damage|Other",
  "status": "Active|Closed|Discovery|Trial|Mediation|Pleadings|Review",
  "priority": "High|Medium|Low",
  "attorney": "Attorney name or Unassigned",
  "value": numeric value,
  "claimNo": "Claim number",
  "carrier": "Carrier name",
  "reserve": numeric amount,
  "filed": "YYYY-MM-DD",
  "aob": "Yes|No",
  "catastrophe": "Yes|No",
  "coverageType": "Coverage type",
  "summary": "2-3 sentence summary"
}

CRITICAL: Return ONLY valid JSON. No markdown.`
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

    const extracted = JSON.parse(cleanJson);
    res.status(200).json(extracted);
  } catch (error) {
    console.error('Extraction error:', error);
    res.status(500).json({ error: error.message });
  }
}
