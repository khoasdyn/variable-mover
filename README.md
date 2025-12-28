Figma doesn't let you move variables between collections. This plugin fixes that.

Select the variables you want to move, pick a destination collection, and done. Everything stays connected.

Features:
- Move any variable type: Color, Number, String, Boolean
- Select specific variables or use "Select All"
- Keeps scopes (supported properties) exactly as you set them
- Keeps variable aliases (links between variables) working
- Automatically updates all layers using those variables
- Detects duplicate names and skips them to avoid errors

⚠️ Important limitation:
This plugin works within a single file only. If you're moving variables in a library file, other files consuming that library won't be updated — they'll lose connection to the moved variables. This is a Figma API limitation.
