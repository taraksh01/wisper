use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartAgent {
    pub name: String,
    pub system_prompt: String,
    pub active: bool,
}

impl SmartAgent {
    pub fn auto_format() -> Self {
        Self {
            name: "Auto-Format".into(),
            system_prompt: r#"You are an intelligent text formatter. Analyze the user's spoken text and format it appropriately:

- If it sounds like an email draft: format with greeting, body paragraphs, and a sign-off.
- If it contains code or technical keywords: preserve technical casing, backticks, and structure it as a code comment or documentation.
- If it is short and casual: clean up filler words (um, uh, like), fix grammar, but keep the casual tone intact.
- If it is long and formal: write it as a coherent paragraph with proper punctuation and structure.

Output only the formatted text, no explanations."#.into(),
            active: true,
        }
    }
}

pub struct LlmClient {
    base_url: String,
    api_key: String,
    model: String,
}

impl LlmClient {
    pub fn new(base_url: String, api_key: String, model: String) -> Self {
        Self {
            base_url,
            api_key,
            model,
        }
    }

    pub fn process(&self, text: &str, agent: &SmartAgent) -> Result<String, String> {
        let client = reqwest::blocking::Client::new();
        let endpoint = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));

        let body = serde_json::json!({
            "model": self.model,
            "messages": [
                {"role": "system", "content": agent.system_prompt},
                {"role": "user", "content": text}
            ],
            "temperature": 0.3,
            "max_tokens": 1024
        });

        let resp = client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&body)
            .send()
            .map_err(|e| format!("LLM request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("LLM API error: {}", resp.text().unwrap_or_default()));
        }

        let json: Value = resp
            .json()
            .map_err(|e| format!("Failed to parse LLM response: {}", e))?;

        let content = json["choices"][0]["message"]["content"]
            .as_str()
            .ok_or("No content in LLM response")?
            .to_string();

        Ok(content.trim().to_string())
    }
}

#[tauri::command]
pub fn get_default_agents() -> Vec<SmartAgent> {
    vec![SmartAgent::auto_format()]
}