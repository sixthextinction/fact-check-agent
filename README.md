# AI Fact-Checking Agent

AI-powered fact-checking system that uses the Perception-Reasoning-Action (PRA) pattern with a handwritten Plan-and-Execute engine to verify claims by searching the web with Bright Data's SERP API, and then analyzing results with OpenAI.

## Features

- **Intelligent Search Planning**: AI (Low latency model) determines whether claims need single or multiple focused searches
- **Plan-and-Execute Engine**: Decomposes complex claims into targeted sub-queries for better verification
- **Bright Data SERP + Proxy**: Accesses Google search results at scale through reliable proxy infrastructure
- **AI-Powered Analysis**: Uses AI (Reasoning focused models) to analyze evidence and provide verdicts
- **Confidence Scoring**: Provides confidence levels (0-100%) for fact-checking results
- **Multiple Verdict Types**: True, Likely True, Misleading, False, Likely False, or Unverifiable

## Architecture

The system follows the **Perception-Reasoning-Action (PRA)** pattern:

### 1. Perception Phase
- **Planning**: AI analyzes claim complexity to determine search strategy
- **Execution**: Performs single search or parallel sub-searches based on decomposition
- **Data Gathering**: Collects and structures search results from Google using Bright Data SERP API

### 2. Reasoning Phase
- **AI Analysis**: Uses OpenAI to analyze gathered evidence
- **Verdict Generation**: Provides fact-checking verdict with confidence score
- **Evidence-Based**: Analysis strictly based on collected search results

### 3. Action Phase
- **Results Display**: Presents analysis results in structured format
- **Metadata Tracking**: Logs execution time, sources analyzed, and search strategy used

## Modules

- main.js: Runs everything; handles CLI, agents, and report generation.
- config.js: Central config for knobs/dials to turn.
- agent.js: The heart of the operation. Runs the Perceive -> Reason -> Reflect lifecycle per city; handles retries, steps, and analysis.
- ai.js: Functions that handle talking to LLMs.
- search.js: Uses Bright Data SERP API to fetch web search results.
- cache.js: Simple filesystem-based cache for API responses to reduce cost and latency.
- context.js: Stores each agent's central working memory.
- strategies.js: Strategy management, adaptation.
- scoring.js: City scoring logic.
- reports.js: Generates the final markdown report.
- utils.js: Project-wide helper functions (e.g., file ops, delays).


## Prerequisites

1. **Node.js** (v14 or higher)
2. **OpenAI API Key** - For AI analysis and planning
3. **Bright Data Account** - For gathering Google search results at scale via proxy

## Installation

1. Clone the repository and navigate to the fact-checker directory:
```bash
cd scripts/fact-checker
```

2. Install dependencies:
```bash
npm install https-proxy-agent node-fetch @ai-sdk/openai ai zod dotenv
```

3. Create a `.env` file in the project root with your credentials:
```env
OPENAI_API_KEY=your_openai_api_key_here
BRIGHT_DATA_CUSTOMER_ID=your_customer_id
BRIGHT_DATA_ZONE=your_zone_name
BRIGHT_DATA_PASSWORD=your_zone_password
```

## Usage

### Command Line Usage

Run with a custom claim:
```bash
node fact-check-simple.js "Your claim to fact-check here"
```

Run with default test claim:
```bash
node fact-check-simple.js
```

### Programmatic Usage

```javascript
const { agentTick } = require('./fact-check-simple.js');

async function checkClaim() {
  const result = await agentTick("Climate change is caused by human activities");
  console.log(result.summary);
}

checkClaim();
```

## Configuration

The system uses the following configuration for Bright Data proxy:

```javascript
const CONFIG = {
  customerId: process.env.BRIGHT_DATA_CUSTOMER_ID,
  zone: process.env.BRIGHT_DATA_ZONE,
  password: process.env.BRIGHT_DATA_PASSWORD,
  proxyHost: 'brd.superproxy.io',
  proxyPort: 33335
};
```

## Example Output

```
Starting Simple AI Fact-Checking Agent...

Architecture: Perception-Reasoning-Action (PRA) Pattern
Planning: Plan-and-Execute Engine
Data: Bright Data Proxy + Google SERP
────────────────────────────────────────────────────────────
Processing claim: "Vaccines cause autism and are unsafe for children"

PLAN DECOMPOSITION: Analyzing claim complexity...
Plan decision: DECOMPOSE
Sub-queries: 2
   1. vaccines autism link scientific evidence
   2. vaccine safety children adverse effects

PLAN EXECUTION: Starting search strategy...
Executing parallel search strategy (2 queries)
   Sub-search 1: "vaccines autism link scientific evidence"
   Sub-search 2: "vaccine safety children adverse effects"

SUCCESS: All sub-searches completed, merging results...
SUCCESS: Perception complete: 15 sources gathered via decomposed search

REASONING PHASE: AI analysis and decision making...
Invoking AI reasoning...
SUCCESS: Reasoning complete: False (95% confidence)

ACTION PHASE: Taking actions based on analysis...

AGENT ANALYSIS COMPLETE:
════════════════════════════════════════════════════════════
Claim: Vaccines cause autism and are unsafe for children
Verdict: False
Confidence: 95%
Sources: 15
Search Strategy: decomposed
Sub-queries: vaccines autism link scientific evidence, vaccine safety children adverse effects
Explanation: Multiple scientific studies and health organizations consistently show no link between vaccines and autism, and vaccines are considered safe for children with rare serious adverse effects.
════════════════════════════════════════════════════════════

SUCCESS: AI Agent execution completed successfully!
Total execution time: 12543ms
Final verdict: False (95% confidence)
```

## API Reference

### Main Functions

#### `agentTick(claim)`
Main entry point that executes the full PRA cycle.
- **Parameters**: `claim` (string) - The claim to fact-check
- **Returns**: Promise resolving to analysis result object

#### `perceive(claim)`
Perception phase that gathers and structures data.
- **Parameters**: `claim` (string) - The claim to research
- **Returns**: Promise resolving to perception object with search results

#### `reason(claim, perception)`
Reasoning phase that analyzes evidence using AI.
- **Parameters**: 
  - `claim` (string) - The original claim
  - `perception` (object) - Data from perception phase
- **Returns**: Promise resolving to reasoning object with verdict

#### `act(claim, perception, reasoning)`
Action phase that displays results and takes actions.
- **Parameters**:
  - `claim` (string) - The original claim
  - `perception` (object) - Data from perception phase
  - `reasoning` (object) - Analysis from reasoning phase
- **Returns**: Promise resolving to action result object

## Result Structure

The system returns a comprehensive result object:

```javascript
{
  claim: "Original claim text",
  execution_time_ms: 12543,
  timestamp: "2024-01-15T10:30:45.123Z",
  phases: {
    perception: { /* perception data */ },
    reasoning: { /* AI analysis */ },
    actions: { /* actions taken */ }
  },
  summary: {
    verdict: "False",
    confidence: 95,
    sources_analyzed: 15,
    search_strategy: "decomposed"
  }
}
```

## Verdict Types

- **True**: Claim is supported by evidence
- **Likely True**: Claim is probably accurate based on available evidence
- **Misleading**: Claim contains some truth but is misleading or lacks context
- **False**: Claim is contradicted by evidence
- **Likely False**: Claim is probably inaccurate based on available evidence
- **Unverifiable**: Insufficient evidence to make a determination

## Error Handling

The system includes comprehensive error handling:

- **API Failures**: Graceful degradation when OpenAI API is unavailable
- **Proxy Issues**: Clear error messages for Bright Data proxy problems
- **Network Errors**: Retry logic and fallback mechanisms
- **Parsing Errors**: Robust handling of malformed search results

## Performance Considerations

- **Parallel Processing**: Sub-searches execute in parallel for better performance
- **Result Caching**: Duplicate search results are automatically filtered
- **Optimized Parsing**: Single-pass data processing for efficiency
- **Timeout Handling**: Reasonable timeouts prevent hanging requests

## Security Notes

- For this tutorial, SSL certificate verification is disabled for proxy connections (`NODE_TLS_REJECT_UNAUTHORIZED = 0`)
- If you need this, see [this Bright Data page for details.](https://docs.brightdata.com/general/account/ssl-certificate#how-to-download-the-ssl-certificate)
- No user data is logged or stored permanently

## Troubleshooting

### Common Issues

1. **"OpenAI API key not found"**
   - Ensure `OPENAI_API_KEY` is set in your `.env` file

2. **"Proxy request failed"**
   - Check Bright Data credentials in `.env` file
   - Verify Bright Data zone is active and has available traffic

3. **"Received HTML instead of JSON"**
   - Bright Data proxy may not be configured correctly
   - Check zone settings in Bright Data dashboard

4. **High execution times**
   - Complex claims with many sub-queries take longer
   - Network latency affects proxy request times


## License

This project is licensed under the MIT License.

## Disclaimer

This tool is for educational and research purposes. Always verify important claims through multiple authoritative sources. The AI analysis is based on search results and should not be considered definitive fact-checking. 
