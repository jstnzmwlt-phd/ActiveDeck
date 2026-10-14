import os

output_file = "activedeck_codebase.txt"
ignore_dirs = {".git", "node_modules", "__pycache__", ".next", "venv", "env", "build", "dist"}
ignore_exts = {".exe", ".jpg", ".png", ".pyc", ".zip", ".env", ".pdf", ".ico", ".json"}

with open(output_file, "w", encoding="utf-8") as outfile:
    for root, dirs, files in os.walk("."):
        # Modify dirs in-place to skip ignored directories
        dirs[:] = [d for d in dirs if d not in ignore_dirs]
        for file in files:
            if any(file.endswith(ext) for ext in ignore_exts):
                continue
            
            filepath = os.path.join(root, file)
            # Ignore the script itself and the output file
            if file == "pack_code.py" or file == output_file:
                continue

            outfile.write(f"\n{'='*50}\n")
            outfile.write(f"FILE: {filepath}\n")
            outfile.write(f"{'='*50}\n\n")
            
            try:
                with open(filepath, "r", encoding="utf-8") as infile:
                    outfile.write(infile.read())
            except Exception as e:
                outfile.write(f"[Skipping unreadable/binary file]\n")

print(f"Codebase packed successfully into {output_file}")