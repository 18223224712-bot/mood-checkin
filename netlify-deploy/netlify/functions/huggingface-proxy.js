// Netlify Function: Hugging Face API 代理
// 这个文件需要部署到 Netlify Functions
// 路径: netlify/functions/huggingface-proxy.js

exports.handler = async (event, context) => {
    // 处理CORS预检请求
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: ''
        };
    }

    // 只允许POST请求
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        // 解析请求体
        const { messages, systemPrompt } = JSON.parse(event.body);

        // 验证请求参数
        if (!messages || !Array.isArray(messages)) {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ error: 'Invalid request: messages is required' })
            };
        }

        // 从环境变量获取API Key（需要在Netlify后台配置）
        const apiKey = process.env.HUGGINGFACE_API_KEY;
        const model = process.env.HUGGINGFACE_MODEL || 'meta-llama/Llama-3.2-3B-Instruct';
        
        if (!apiKey) {
            return {
                statusCode: 500,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    error: 'API Key not configured. Please set HUGGINGFACE_API_KEY in Netlify environment variables.' 
                })
            };
        }

        // 构建对话文本（Hugging Face使用文本格式）
        const conversationText = messages.map(msg => {
            if (msg.role === 'system') {
                return `系统: ${msg.content}`;
            } else if (msg.role === 'user') {
                return `用户: ${msg.content}`;
            } else {
                return `助手: ${msg.content}`;
            }
        }).join('\n');

        const prompt = `${systemPrompt || '你是一个温暖、贴心的情感陪伴助手。'}\n\n${conversationText}\n助手:`;

        // 调用Hugging Face API
        const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: prompt,
                parameters: {
                    max_new_tokens: 200,
                    temperature: 0.7,
                    return_full_text: false
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            let errorMessage;
            try {
                const errorJson = JSON.parse(errorData);
                errorMessage = errorJson.error || errorData;
            } catch {
                errorMessage = errorData;
            }
            
            return {
                statusCode: response.status,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    error: `Hugging Face API error: ${errorMessage}` 
                })
            };
        }

        const data = await response.json();
        
        // Hugging Face返回格式可能是数组或对象
        let generatedText = '';
        if (Array.isArray(data)) {
            generatedText = data[0]?.generated_text || '';
        } else if (data.generated_text) {
            generatedText = data.generated_text;
        } else if (typeof data === 'string') {
            generatedText = data;
        }

        // 提取助手回复（如果包含完整对话，只取助手部分）
        if (generatedText.includes('助手:')) {
            generatedText = generatedText.split('助手:').pop().trim();
        }

        // 清理文本（移除可能的重复前缀）
        generatedText = generatedText.replace(/^助手:\s*/i, '').trim();

        if (!generatedText) {
            return {
                statusCode: 500,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    error: 'Invalid response from Hugging Face API' 
                })
            };
        }
        
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: JSON.stringify({
                content: generatedText
            })
        };

    } catch (error) {
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                error: error.message || 'Internal server error'
            })
        };
    }
};
