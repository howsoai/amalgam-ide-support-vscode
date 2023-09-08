#!/usr/bin/env python
import json

# NOTE:
# 1) operate inside the /amalgam/documentation directory in the Amalgam project
# 2) save languange.js as languange.json as a js list without the var declaration and the ; at the end
# 3) run this script
# 4) overwrite snippets/amalgam.snippets.json in this project with the generated amalgam.json file

f = open('language.json', 'r')
data = json.loads(f.read(), strict=False)
f.close()

output = dict()
for i in data:
    param = i['parameter']
    description = i['description']
    opcode = "(" + param.split()[0]
    output[opcode] = {
        "prefix" : opcode,
        "body" : [opcode],
        "description" : param + " || " + description
    }

f = open("amalgam.snippets.json", "a")
f.write(json.dumps(output, indent=4))
f.close()
