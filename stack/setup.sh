#!/bin/bash
# setup.sh - One-command setup for MorphArray Stack VS Code Extension

set -e  # Exit immediately if a command fails

echo "🔧 Setting up MorphArray Stack extension..."

# Clean previous install
echo "Cleaning previous build artifacts..."
rm -rf node_modules dist out package-lock.json .vscode-test

# Install dependencies (including turndown)
echo "Installing dependencies..."
npm install

# Create required folders
echo "Creating project structure..."
mkdir -p articles templates css dist stacks

# Create placeholder files
cat > templates/base.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{title}}</title>
    <link rel="stylesheet" href="css/main.css">
</head>
<body>
    <header>
        <h1>{{title}}</h1>
        <p class="date">{{date}}</p>
    </header>
    
    <main>
        {{content}}
    </main>
    
    <footer>
        <nav>{{navigation}}</nav>
    </footer>
</body>
</html>
EOF

cat > css/main.css << 'EOF'
body {
    font-family: system-ui, -apple-system, sans-serif;
    line-height: 1.6;
    max-width: 800px;
    margin: 2rem auto;
    padding: 0 1rem;
}
EOF

# Create empty placeholder files
touch articles/.gitkeep
touch stacks/.gitkeep

echo "✅ Setup completed successfully!"
echo ""
echo "Next steps:"
echo "   1. Open this folder in VS Code"
echo "   2. Press F5 to launch the Extension Development Host"
echo "   3. In the new window, open the 'example_workspace' folder (or create your own)"
echo "   4. Run 'MorphArray: Rebuild Dynamic Story' from the Command Palette (Cmd+Shift+P)"
echo ""
echo "Your extension is ready to develop!"