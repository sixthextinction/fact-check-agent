// Simple AI Fact-Checking Agent with Plan-and-Execute Engine

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
const { HttpsProxyAgent } = require('https-proxy-agent');
const fetch = require('node-fetch');

const { openai } = require('@ai-sdk/openai');
const { generateObject } = require('ai');
const { z } = require('zod');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  customerId: process.env.BRIGHT_DATA_CUSTOMER_ID,
  zone: process.env.BRIGHT_DATA_ZONE,
  password: process.env.BRIGHT_DATA_PASSWORD,
  proxyHost: 'brd.superproxy.io',
  proxyPort: 33335
};

// ============================================================================
// PLAN-AND-EXECUTE ENGINE
// ============================================================================

// AI decides whether a claim should be broken down into multiple focused searches
async function shouldDecompose(claim) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.log('WARNING: OpenAI API key not found, using single search approach');
      return { needs_breakdown: false };
    }

    console.log('PLAN DECOMPOSITION: Analyzing claim complexity...');

    const result = await generateObject({
      model: openai('gpt-4o-mini'),
      schema: z.object({
        needs_breakdown: z.boolean(),
        sub_queries: z.array(z.string()).optional(),
        reasoning: z.string()
      }),
      prompt: `Should this claim be broken into multiple focused searches for better fact-checking?

Claim: "${claim}"

Consider:
- Does this claim have multiple distinct parts that need separate verification?
- Would different search queries target different aspects more effectively?
- Is this complex enough to benefit from decomposition?

If yes, provide 2-3 specific search queries that target different aspects.
If no, return needs_breakdown: false.

Examples:
- "Vaccines cause autism" → Single search (one claim)
- "Vaccines cause autism and are unsafe for children" → Multiple searches (two distinct claims)
- "Climate policies reduced emissions while maintaining economic growth" → Multiple searches (emissions data, policy effects, economic impact)`
    });

    console.log(`Plan decision: ${result.object.needs_breakdown ? 'DECOMPOSE' : 'SINGLE SEARCH'}`);
    if (result.object.needs_breakdown) {
      console.log(`Sub-queries: ${result.object.sub_queries?.length || 0}`);
      result.object.sub_queries?.forEach((query, i) => {
        console.log(`   ${i + 1}. ${query}`);
      });
    }

    return result.object;

  } catch (error) {
    console.error('ERROR: Plan decomposition failed:', error.message);
    return { needs_breakdown: false, reasoning: `Decomposition failed: ${error.message}` };
  }
}

// Executes the search plan - either single search or parallel sub-searches based on decomposition
async function executePlan(claim, decomposition) {
  console.log('PLAN EXECUTION: Starting search strategy...');

  if (!decomposition.needs_breakdown) {
    console.log('Executing single search strategy');
    return await fetchWithBrightDataProxy(claim);
  }

  console.log(`Executing parallel search strategy (${decomposition.sub_queries?.length} queries)`);

  try {
    const subResults = await Promise.all(
      decomposition.sub_queries.map(async (query, index) => {
        console.log(`   Sub-search ${index + 1}: "${query}"`);
        return await fetchWithBrightDataProxy(query);
      })
    );

    console.log('SUCCESS: All sub-searches completed, merging results...');

    return {
      original_claim: claim,
      search_strategy: 'decomposed',
      sub_searches: decomposition.sub_queries,
      decomposition_reasoning: decomposition.reasoning,
      combined_results: mergeSearchResults(subResults),
      individual_results: subResults
    };

  } catch (error) {
    console.error('ERROR: Parallel search execution failed:', error.message);
    console.log('Falling back to single search...');
    return await fetchWithBrightDataProxy(claim);
  }
}

// Combines multiple search results into a single result set, removing duplicates
function mergeSearchResults(results) {
  console.log('Merging search results...');

  const merged = {
    organic: [],
    knowledge: null,
    people_also_ask: []
  };

  results.forEach((result, index) => {
    if (result.organic) {
      const organicWithSource = result.organic.map(item => ({
        ...item,
        source_query_index: index,
        source_query: results.length > 1 ? `sub-search-${index + 1}` : 'main-search'
      }));
      merged.organic.push(...organicWithSource);
    }
  });

  merged.knowledge = results.find(r => r.knowledge)?.knowledge || null;

  results.forEach(result => {
    if (result.people_also_ask) {
      merged.people_also_ask.push(...result.people_also_ask);
    }
  });

  // Remove duplicates based on links
  const seenLinks = new Set();
  merged.organic = merged.organic.filter(item => {
    if (seenLinks.has(item.link)) return false;
    seenLinks.add(item.link);
    return true;
  });

  console.log(`Merged results: ${merged.organic.length} unique organic results`);
  return merged;
}

// ============================================================================
// BRIGHT DATA PROXY SEARCH
// ============================================================================

// Fetches Google search results through Bright Data proxy with JSON response
async function fetchWithBrightDataProxy(claim) {
  try {
    const proxyUrl = `http://brd-customer-${CONFIG.customerId}-zone-${CONFIG.zone}:${CONFIG.password}@${CONFIG.proxyHost}:${CONFIG.proxyPort}`;

    const agent = new HttpsProxyAgent(proxyUrl, {
      rejectUnauthorized: false
    });

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(claim)}&brd_json=1`;

    console.log(`Fetching search results through Bright Data proxy...`);
    console.log(`Query: ${claim}`);

    const response = await fetch(searchUrl, {
      method: 'GET',
      agent: agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json, text/html, */*',
        'Accept-Encoding': 'gzip, deflate, br'
      }
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status} - ${response.statusText}`);
    }

    let data;
    try {
      data = JSON.parse(responseText);
      console.log('SUCCESS: Successfully received structured JSON data');
      logSearchResultsSummary(data);
      return data;

    } catch (parseError) {
      if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
        throw new Error('Received HTML instead of JSON - proxy may not be working correctly');
      } else {
        throw new Error('Response is not valid JSON');
      }
    }
  } catch (error) {
    console.error('ERROR: Proxy request failed:', error.message);
    throw error;
  }
}

// Logs a summary of search results including counts and top results
function logSearchResultsSummary(data) {
  const summaryItems = [];

  if (data.organic?.length > 0) {
    summaryItems.push(`${data.organic.length} organic results`);
  }
  if (data.ads?.length > 0) {
    summaryItems.push(`${data.ads.length} ads`);
  }
  if (data.knowledge_graph) {
    summaryItems.push('knowledge graph data');
  }

  if (summaryItems.length > 0) {
    console.log(`Found: ${summaryItems.join(', ')}`);
  }

  if (data.organic?.length > 0) {
    console.log('Top 3 results:');
    data.organic.slice(0, 3).forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.title || 'No title'}`);
      console.log(`      ${result.link || 'No link'}`);
    });
  }
}

// Builds complete perception object directly from raw search results (optimized single-pass)
function buildPerceptionFromSearchData(searchResults, claim, searchStrategy, subSearches) {
  // Clean and structure the search data
  const cleanedGoogleSearch = {
    organic: searchResults.organic?.map(result => ({
      title: result.title,
      description: result.description,
      link: result.link,
      display_link: result.display_link
    })) || [],
    knowledge: searchResults.knowledge ? {
      description: searchResults.knowledge.description,
      facts: searchResults.knowledge.facts?.map(fact => ({
        key: fact.key,
        value: fact.value
      })) || []
    } : null,
    people_also_ask: searchResults.people_also_ask?.map(paa => ({
      question: paa.question,
      answers: paa.answers?.map(answer => ({
        text: answer.value?.text
      })) || []
    })) || []
  };

  // Return complete perception object in single pass
  return {
    timestamp: new Date().toISOString(),
    claim: claim,
    search_strategy: searchStrategy,
    sub_searches: subSearches,
    sources: {
      google_search: cleanedGoogleSearch,
      raw_data: searchResults
    },
    metadata: {
      organic_results_count: cleanedGoogleSearch.organic?.length || 0,
      has_knowledge_graph: !!cleanedGoogleSearch.knowledge,
      people_also_ask_count: cleanedGoogleSearch.people_also_ask?.length || 0,
      used_plan_decomposition: searchStrategy === 'decomposed'
    }
  };
}

// ============================================================================
// AGENT ARCHITECTURE: PERCEPTION-REASONING-ACTION
// ============================================================================

// Gathers and structures environmental data using the Plan-and-Execute engine
async function perceive(claim) {
  console.log('PERCEPTION PHASE: Gathering environmental data...');

  try {
    // STEP 1: PLANNING - AI decides search strategy (single vs decomposed)
    // do we need single or multiple focused searches?
    const decomposition = await shouldDecompose(claim);

    // STEP 2: EXECUTION - Execute the planned search strategy
    // perform single search or parallel sub-searches based on decomposition plan
    const rawSearchData = await executePlan(claim, decomposition);

    // decide on a return format based on that
    let actualSearchData;
    let searchStrategy = 'single';
    let subSearches = null;

    if (rawSearchData.search_strategy === 'decomposed') {
      // Decomposed search: extract merged results and sub-query metadata
      actualSearchData = rawSearchData.combined_results;
      searchStrategy = 'decomposed';
      subSearches = rawSearchData.sub_searches;
      console.log(`Used decomposed search strategy with ${subSearches.length} sub-queries`);
    } else {
      // Single search: use results directly
      actualSearchData = rawSearchData;
      console.log('Used single search strategy');
    }

    // STEP 3: PERCEPTION BUILDING - Transform raw data into structured agent perception
    // clean, structure, and enrich data with metadata for the reasoning phase
    const perception = buildPerceptionFromSearchData(actualSearchData, claim, searchStrategy, subSearches);

    console.log(`SUCCESS: Perception complete: ${perception.metadata.organic_results_count} sources gathered via ${searchStrategy} search`);
    return perception;

  } catch (error) {
    console.error('ERROR: Perception phase failed:', error.message);
    throw new Error(`Perception failure: ${error.message}`);
  }
}

// Uses AI to analyze the claim and provide a verdict based on gathered evidence
async function reason(claim, perception) {
  console.log('REASONING PHASE: AI analysis and decision making...');

  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }

    const searchData = perception.sources.google_search;
    const formattedResults = JSON.stringify(searchData, null, 2);

    const prompt = `You are a fact-checking assistant. Analyze the given claim based solely on the provided search results.

Claim: "${claim}"

Search Results:
${formattedResults}

Based only on the information in the search results:
1. Determine if the claim is: True, Likely True, Misleading, False, Likely False, or Unverifiable
2. Provide a concise explanation referencing specific search results
3. Include a confidence score (0-100) for your assessment
4. Do not use external knowledge - stick to the provided data

Output in JSON format with "verdict", "explanation", and "confidence" keys.`;

    console.log('Invoking AI reasoning...');

    const result = await generateObject({
      model: openai('o4-mini'),
      schema: z.object({
        verdict: z.enum(['True', 'Likely True', 'Misleading', 'False', 'Likely False', 'Unverifiable']),
        explanation: z.string(),
        confidence: z.number().min(0).max(100).describe('Confidence score from 0-100')
      }),
      prompt: prompt
    });

    const reasoning = {
      timestamp: new Date().toISOString(),
      claim: claim,
      verdict: result.object.verdict,
      explanation: result.object.explanation,
      confidence: result.object.confidence,
      sources_analyzed: perception.metadata.organic_results_count,
      reasoning_model: 'o4-mini'
    };

    console.log(`SUCCESS: Reasoning complete: ${reasoning.verdict} (${reasoning.confidence}% confidence)`);
    return reasoning;

  } catch (error) {
    console.error('ERROR: Reasoning phase failed:', error.message);

    return {
      timestamp: new Date().toISOString(),
      claim: claim,
      verdict: 'Unverifiable',
      explanation: `AI reasoning failed: ${error.message}`,
      confidence: 0,
      sources_analyzed: perception?.metadata?.organic_results_count || 0,
      reasoning_model: 'error-fallback'
    };
  }
}

// Takes actions based on the reasoning results, primarily displaying the analysis
async function act(claim, perception, reasoning) {
  console.log('ACTION PHASE: Taking actions based on analysis...');

  try {
    // Simple console display for now
    console.log('\nAGENT ANALYSIS COMPLETE:');
    console.log('═'.repeat(60));
    console.log(`Claim: ${claim}`);
    console.log(`Verdict: ${reasoning.verdict}`);
    console.log(`Confidence: ${reasoning.confidence}%`);
    console.log(`Sources: ${perception.metadata.organic_results_count}`);
    console.log(`Search Strategy: ${perception.search_strategy}`);
    if (perception.sub_searches) {
      console.log(`Sub-queries: ${perception.sub_searches.join(', ')}`);
    }
    console.log(`Explanation: ${reasoning.explanation}`);
    console.log('═'.repeat(60));

    return {
      timestamp: new Date().toISOString(),
      claim: claim,
      actions_taken: ['display_results'],
      status: 'success'
    };

  } catch (error) {
    console.error('ERROR: Action phase failed:', error.message);
    return {
      timestamp: new Date().toISOString(),
      claim: claim,
      actions_taken: [],
      status: 'failed',
      error: error.message
    };
  }
}

// Main agent execution cycle that orchestrates the Perception-Reasoning-Action flow
async function agentTick(claim) {
  console.log('AGENT TICK: Starting PRA cycle...');
  console.log(`Target claim: "${claim}"`);
  console.log('─'.repeat(60));

  const startTime = Date.now();

  try {
    const perception = await perceive(claim);
    const reasoning = await reason(claim, perception);
    const actions = await act(claim, perception, reasoning);

    const endTime = Date.now();
    const executionTime = endTime - startTime;

    const agentResult = {
      claim: claim,
      execution_time_ms: executionTime,
      timestamp: new Date().toISOString(),
      phases: {
        perception,
        reasoning,
        actions
      },
      summary: {
        verdict: reasoning.verdict,
        confidence: reasoning.confidence,
        sources_analyzed: perception.metadata.organic_results_count,
        search_strategy: perception.search_strategy
      }
    };

    console.log(`\nAGENT TICK COMPLETE (${executionTime}ms)`);
    return agentResult;

  } catch (error) {
    const endTime = Date.now();
    const executionTime = endTime - startTime;

    console.error('FATAL: AGENT TICK FAILED:', error.message);

    return {
      claim: claim,
      execution_time_ms: executionTime,
      timestamp: new Date().toISOString(),
      error: error.message,
      status: 'failed'
    };
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

// Entry point that initializes and runs the fact-checking agent
async function main() {
  try {
    console.log('Starting Simple AI Fact-Checking Agent...\n');
    console.log('Architecture: Perception-Reasoning-Action (PRA) Pattern');
    console.log('Planning: Plan-and-Execute Engine');
    console.log('Data: Bright Data Proxy + SERP API (Google)');
    console.log('─'.repeat(60));

    // claim to test
    const testClaim = process.argv[2] || "Vaccines cause autism and are unsafe for children";

    console.log(`Processing claim: "${testClaim}"`);

    const result = await agentTick(testClaim);

    if (result.error) {
      console.error('\nFATAL: Agent execution failed:', result.error);
      process.exit(1);
    } else {
      console.log('\nSUCCESS: AI Agent execution completed successfully!');
      console.log(`Total execution time: ${result.execution_time_ms}ms`);
      console.log(`Final verdict: ${result.summary.verdict} (${result.summary.confidence}% confidence)`);
    }

  } catch (error) {
    console.error('FATAL ERROR:', error.message);
    process.exit(1);
  }
}

// Allow command line usage: node fact-check-simple.js "Your claim here"
if (require.main === module) {
  main();
}

module.exports = { agentTick, perceive, reason, act }; 
