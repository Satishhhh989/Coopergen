// This is your new backend!
// Vercel will turn this file into a serverless function at the path /api/generate

// This config tells Vercel to run this as an "Edge Function"
// which is fast and efficient.
export const config = {
  runtime: 'edge',
};

// This is the main function that handles requests
export default async function handler(request: Request) {
  // 1. We only accept POST requests (from our frontend)
  if (request.method !== 'POST') {
    return new Response('Error: Method Not Allowed', { status: 405 });
  }

  // 2. Get the prompt, model, and seed from the frontend's request
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response('Error: Invalid JSON body', { status: 400 });
  }
  
  const { prompt, model, seed } = body;

  if (!prompt || !model) {
    return new Response('Error: Missing prompt or model', { status: 400 });
  }

  // 3. This is the SECURE part.
  // We get the API key from the server's environment variables.
  // This key is *NEVER* sent to the frontend.
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    // This will show up in your Vercel logs, not to the user.
    console.error('OPENROUTER_API_KEY is not set on the server!');
    return new Response('Error: Server configuration error', { status: 500 });
  }

  // 4. Prepare the request to OpenRouter
  // This is the *same* call your frontend used to make, but now
  // it's happening safely on the server.
  const openRouterPayload = {
    model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are an exam paper generator. You must ONLY return a strict JSON object following the requested schema. Do not include markdown or commentary.",
      },
      { role: "user", content: prompt },
    ],
    seed,
  };

  try {
    // 5. Call the OpenRouter API from our backend
    const apiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Here is where we securely add the API key
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://qpaper-forge.com", // Set your future site URL
        "X-Title": "QPaper Forge", // Set your site name
      },
      body: JSON.stringify(openRouterPayload),
    });

    // 6. Check if OpenRouter had an error
    if (!apiResponse.ok) {
      const errorBody = await apiResponse.text();
      console.error("OpenRouter API Error:", errorBody);
      return new Response(`Error from AI API: ${apiResponse.statusText}`, { status: apiResponse.status });
    }

    // 7. Stream the response from OpenRouter directly back to our frontend.
    // This is efficient and fast.
    return new Response(apiResponse.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });

  } catch (e: any) {
    console.error("Internal Server Error:", e);
    return new Response(`Error: ${e.message || 'Unknown error'}`, { status: 500 });
  }
}