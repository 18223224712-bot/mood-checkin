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

        // 从环境变量获取API Key（优先使用环境变量）
        // 如果环境变量未配置，可以使用请求中的apiKey（备用方案）
        let apiKey = process.env.HUGGINGFACE_API_KEY;
        const model = process.env.HUGGINGFACE_MODEL || 'meta-llama/Llama-3.2-3B-Instruct';
        
        // 如果环境变量未配置，尝试从请求中获取（备用方案）
        if (!apiKey) {
            const requestData = JSON.parse(event.body);
            apiKey = requestData.apiKey;
        }
        
        if (!apiKey) {
            return {
                statusCode: 500,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    error: 'API Key not configured. Please set HUGGINGFACE_API_KEY in Netlify environment variables or provide apiKey in request.' 
                })
            };
        }

        // 使用新的 router.huggingface.co API（OpenAI兼容格式）
        // 转换消息格式为 OpenAI 兼容格式
        const openaiMessages = messages.map(msg => ({
            role: msg.role === 'system' ? 'system' : msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
        }));

        // 如果有 systemPrompt，添加到消息列表开头
        if (systemPrompt) {
            openaiMessages.unshift({
                role: 'system',
                content: systemPrompt
            });
        }

        // 调用新的 router.huggingface.co API
        // 使用 /v1/chat/completions 端点（OpenAI兼容）
        const response = await fetch(`https://router.huggingface.co/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model, // 例如: meta-llama/Llama-3.2-3B-Instruct
                messages: openaiMessages,
                max_tokens: 200,
                temperature: 0.7
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
        
        // 新的 router API 返回 OpenAI 兼容格式
        // 格式: { choices: [{ message: { content: "..." } }] }
        let generatedText = '';
        
        if (data.choices && data.choices.length > 0) {
            // OpenAI 兼容格式
            generatedText = data.choices[0]?.message?.content || '';
        } else if (data.content) {
            // 直接 content 字段
            generatedText = data.content;
        } else if (Array.isArray(data)) {
            // 旧格式（数组）
            generatedText = data[0]?.generated_text || '';
        } else if (data.generated_text) {
            // 旧格式（对象）
            generatedText = data.generated_text;
        } else if (typeof data === 'string') {
            generatedText = data;
        }

        // 清理文本
        generatedText = generatedText.trim();

        if (!generatedText) {
            return {
                statusCode: 500,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    error: 'Invalid response from Hugging Face API',
                    debug: JSON.stringify(data)
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
