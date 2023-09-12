# Amalgam&trade; VSCode Extension

The Amalgam VSCode extension provides support for syntax highlighting and debugging for the
[Amalgam](https://github.com/howsoai/amalgam) language.

## Highlighting Theme

To switch highlighting themes: `CTRL-K-T`

# Usage

This extension supports debugging Amalgam scripts as well as Trace files produced by using the Python interface for Amalgam: [amalgam-lang-py](https://github.com/howsoai/amalgam-lang-py).

### Example launch.json configurations:

Below is an example of a launch.json configuration used to debug the Amalgam script that is currently being edited:

```json
{
  "type": "amalgam",
  "request": "launch",
  "name": "Run Amalgam",
  "program": "${file}",
  "stopOnEntry": false,
  "executable": "/path/to/your/amalgam_interpreter"
},
```

Below is an example of a `launch.json` configuration used to debug using a trace file produced by `amalgam-lang-py`:

```json
{
  "type": "amalgam",
  "request": "launch",
  "name": "Run Trace",
  "program": "${workspaceFolder}/howso.amlg",
  "executable": "/path/to/your/amalgam_interpreter",
  "tracefile": "${file}",
  "stopOnEntry": false
},
```

### VSCode launch.json configuration options

| Option           | Required | Type     | Description |
| ---------------- | -------- | -------- | ----------- |
| program          | Yes      | string   | The path to an amalgam file to run/debug. |
| workingDirectory | No       | string   | The directory to change into before executing the program. |
| executable       | No       | string   | The absolute path to the Amalgam executable. |
| tracefile        | No       | string   | A path to a trace file to run against program. |
| args             | No       | string[] | Array of additional CLI arguments to pass to the Amalgam executable. |
| stopOnEntry      | No       | boolean  | Automatically stop program after launch (when in debug) |

## License

[License](LICENSE.txt)

## Contributing

[Contributing](CONTRIBUTING.md)
