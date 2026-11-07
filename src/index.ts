import { withGitHubOAuth } from "./auth";
import { mcpApi } from "./mcp";

export default withGitHubOAuth(mcpApi) satisfies ExportedHandler<Env>;
