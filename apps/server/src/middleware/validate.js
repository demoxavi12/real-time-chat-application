import { parseWithSchema } from '../validators/parseWithSchema.js'

/**
 * Validates request parts against zod schemas, e.g.
 *   router.post('/x', validate({ body: schema }), controller)
 * Parsed (coerced/stripped) values replace the originals on `req.validated`.
 */
export function validate(schemas) {
  return (req, _res, next) => {
    req.validated = {}
    for (const location of ['params', 'query', 'body']) {
      if (!schemas[location]) continue
      req.validated[location] = parseWithSchema(
        schemas[location],
        req[location],
        { location },
      )
    }
    next()
  }
}
