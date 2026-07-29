'use strict';

function buildPaginationMeta({ page, limit, total }) {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    hasPreviousPage: page > 1,
    hasNextPage: page * limit < total,
  };
}

module.exports = {
  buildPaginationMeta,
};
