
## General

1. Licensing

   I have never worked on closed source VSCOde extensions. Publishing requires registration with Microsoft. While I do pubilsh Cortex-Debug, I did not register it with the market place. Marcel gave me permission to publish. See https://code.visualstudio.com/api/working-with-extensions/publishing-extension

2. Storage, maintenance and deployment, asset owner

   If you store it on Github, be prepared for support, issues, pull requests, etc. How do we handle this now?

3. Linux Testing: vscode.env.openExternal(...) is broken since last week
   * How to open in an external browser. VSCode will want to edit the HTML file
   * I am using xdg-open, is this available on all distros?

4. All Platforms Testing:
   * Launching of tools (may not find the install-dir)
   * Opening docs

5. Images -- can we do better than the blurry icons? It doesn't matter so much if the whole thing looks bad. But, in VSCode, our icons standout. Rather not have any icons

## Issues

1. Ideally, we want to have our windows appear only in MTB related directories. Once enabled, they seem to be sticky until user disables them. And once disabled, then user has to re-enable them. Nearly impossible to test unless you create a new user. Pissing me off.
    * Same is true of the panel called "NPM SCRIPTS". Once it appears, it is in every workspace.

2. Sometimes, the panels disappear. They are there for the user to enable on the top-right. This happens periodically to the Cortex-Debug created Panels and we can't figure out how that happens.
