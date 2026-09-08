import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { customerController } from "./customer.controller";

const router = Router();

// The tenants the caller reaches, for pickers. Behind `requireAuth` at the
// mount point and scoped in the repository, with no extra permission: the list
// is only ever the caller's own reach, so seeing the name of a company you
// already work in tells you nothing you did not have.
//
// Read only for now. Create/edit/archive is a separate piece of work and a
// stricter gate; it does not belong on the endpoint a picker calls.
router.get("/", asyncHandler(customerController.list));

export const customerRoutes = router;
