# repositories

The only code that runs SQL. One file per table group, named `<area>-repository.js`. Repositories take the database handle as an argument, use prepared statements with bound parameters, and return plain objects in camelCase.
