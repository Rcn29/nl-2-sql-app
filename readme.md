# NL to SQL single page webapp

## Files
The **csv2parquet** folder contains a script to generate an enriched Parquet with labels, as the dataset contains many fields that represent "codes" such as the district codes. 
- In the dataset there is another excel sheet that explains what those codes are, which is decoded using the **map-config.json** to create label columns in the resulting Parquet. The user also has the option of configuring the map config for a multi-sheet setup, or for not creating new label columns and just replacing the existing codes with labels instead.
- Typing of columns is done using **schema.json**. 

The **my-first-worker** folder contains the client and worker code for the app.
- **compile-sql.js** contains the code that retrieves the snippets from vectorize, calls the AI model via AI Gateway, and parses the response to extract the sql and reason.
-  **validate-sql.js** is the SQL validator on the worker side, parsing all of the runnable bits to check for unwanted tokens (for the purposes of this, everything apart from SELECT). 
- **router.js** does a bit more than it ideally should, it is the main entrypoint of the app and handles all API calls, including the upsert which is done through terminal only.

## Design note
### Dataset
As I didn't have any prior experience with Cloudflare, or with AI Gateway, I did not want the dataset that I chose to be the reason I don't get the app done on time, so I went with collision data as it has a good mix of questions that can be asked about it, but is still just a single table dataset, so no joins are required, I instead opted to add some complexity to the prompting with the code/label decoding aspect.
### Retrieval
Retrieval is done by sending a query to Vectorize with the chosen embedding model (currently @cf/baai/bge-large-en-v1.5) and the question, picking the top-k snippets returned, and extracting mentioned tables (in this case, it's always just "collisions" but it can be extended), mentioned columns, and general tags that describe the kind of data the snippet is concerned with.
### Prompt shape and guardrails
The prompt sent to the model contains the following:
- The question itself that is inputted by the user in the webapp
- A schema snapshot of the database (column names and types, and the label columns)
- Some few-shot examples (manually written SQL queries and the question that they answer)
- The retrieved snippets from the retrieval step.
## Known limitations
- I likely did not use the strongest model I could (I wanted to make sure I don't accidentally spend money and I also didn't have experience with any AI integration prior to this project) and as such it sometimes makes errors for more complex queries, be it invalid JSON shape or just errors such as returning results in descending order instead of ascending. I tried mitigating this with the system rules.
- The structure of the project could use  more work, for example **router.js** should not contain the upsert script.
- The dataset chosen does not properly test all implemented features due to being a single-table dataset, so joins are not tested (and are not present in snippets). It also only contains data from 2024 for now, as it is already quite large, though it should be extendable with data from other years.
- Errors are not all displayed correctly (sometimes the model returns an invalid JSON shape and the "sql" and "reason" fields cannot be extracted, this is thrown as a 502 on the worker but the message is lost, showing only a "Bad Gateway" error)
- Some constants used are not set up as environment variables
- The UI is quite rudimentary.

## Next steps
- Look into better, stronger models with potentially paid usage.
- Refactor the code so that responsibilities are segregated better, things that should be set up as environment variables are done so instead of being constants, and readability is generally improved.
- Find a more complex dataset with multiple tables
- Create new snippets for that dataset that include join semantics and other potentially useful things for that case.
- Remove potentially redundant SQL validation so it's not done on both Client and Worker.

## Setup

The already enriched parquet is available in the repo at [collisions_2024_enriched_v2.parquet](https://github.com/Rcn29/nl-2-sql-app/blob/main/my-first-worker/collisions_2024_enriched_v2.parquet "collisions_2024_enriched_v2.parquet"), but if creating it from the CSV and XLSX sheet is necessary, the steps are:

1. Open a terminal window in the **csv2parquet** folder
2. Run "node csv-to-parquet-enrich.mjs  --in ./dft-road-casualty-statistics-collision-2024.csv  --out ./collisions_2024_enriched_v2.parquet  --schema ./schema.json  --map ./map-config.json"
3. Copy the resulting parquet file to the **my-first-worker** folder.
4. Create an R2 bucket on your cloudflare account, or through terminal with "wrangler r2 bucket create \<YOUR-BUCKET-NAME\>
5. Upload the parquet file to the R2 bucket that your Cloudflare Worker uses with "wrangler r2 object put \<YOUR-BUCKET-NAME\>/collisions_2024_enriched_v2.parquet --file ./collisions_2024_enriched_v2.parquet --remote"

If you don't want to generate a new parquet file, you may skip to step 4 (or 5 if you already have the bucket) and just upload the existing one to your R2 bucket.

Now that the Parquet file is in R2, the steps to get the app running are as follows:
1. Create a new application on your Cloudflare account. Set the "name" field in your **wrangler.jsonc** to match your application name.
2. Create an AI Gateway on your Cloudflare account, set it as your GATEWAY_NAME environment variable in **wrangler.jsonc**.
3. Find your AI Gateway account ID and set your GATEWAY_ACCOUNT_ID environment variable.
4. Create an AI Gateway API token on your Cloudflare account using the Workers AI template, and set it as a secret in terminal using "wrangler secret put CF_API_TOKEN"
5. Run "wrangler deploy" to get your base URL (should be of the form \<your-application-name\>.\<your-account-name\>.workers.dev)
6. Upsert your **snippets.json** file with the url "<your-base-url\>/api/snippets.upsert", with content type application/json and with the in-file **snippets.json** (in Powershell this is **Invoke-RestMethod -Method Post -Uri "<your-base-url\>/api/snippets/upsert"  -ContentType 'application/json' -InFile 'snippets.json'**)
7. You should be ready to run the application.
