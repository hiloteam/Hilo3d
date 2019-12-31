We appreciate you submit code to help perfect Hilo. And there are conventions to obey before you commit changes.

## Develop Pull Request
* Send pull request to the ```dev``` branch
* Only accepted committing source code(but not build code)
* Run ```gulp test```, make sure all tests passed
* Format of the commit message (Following [the Anguler rules](https://github.com/angular/angular/blob/22b96b9/CONTRIBUTING.md#type))

    ```
    <type>: <subject>
    ```

    ### Type
    Must be one of the following:

    * **build**: Changes that affect the build system or external dependencies (example scopes: gulp, broccoli, npm)
    * **ci**: Changes to our CI configuration files and scripts (example scopes: Travis, Circle, BrowserStack, SauceLabs)
    * **docs**: Documentation only changes
    * **feat**: A new feature
    * **fix**: A bug fix
    * **perf**: A code change that improves performance
    * **refactor**: A code change that neither fixes a bug nor adds a feature
    * **style**: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
    * **test**: Adding missing tests or correcting existing tests


    etc:

    ```
    fix: view.js WebGLRender bug
    docs: update README.md
    ```
