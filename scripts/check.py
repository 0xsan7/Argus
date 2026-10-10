import json, jsonschema

for f in ["metrics", "run_manifest"]:
    try:
        jsonschema.validate(instance=json.load(open(f'artifacts/{f}.json')), schema=json.load(open(f'tests/schemas/{f}.schema.json')))
        print(f"{f} OK")
    except jsonschema.exceptions.ValidationError as e:
        print(f"{f} Error: {e.message}")
        print(f"Path: {e.json_path}")
